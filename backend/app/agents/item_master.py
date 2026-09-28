import httpx
from sqlalchemy.future import select
from app.db.session import AsyncSessionLocal
from app.models import MapShopifySkuErpItem, ExceptionQueue, ExceptionStatus
from app.agents.state import AgentState
from app.services.erpnext_client import ERPNextClient

async def item_master_agent(state: AgentState) -> AgentState:
    """
    ERPNext Item Master Agent:
    Ensures every classified SKU has a corresponding FG Item in ERPNext.
    """
    classified_skus = state.get("classified_skus", [])
    exceptions = state.get("exceptions", [])
    
    erp_client = ERPNextClient()
    
    async with AsyncSessionLocal() as db:
        for sku in classified_skus:
            # Check local map first
            stmt = select(MapShopifySkuErpItem).where(MapShopifySkuErpItem.shopify_sku == sku)
            result = await db.execute(stmt)
            mapping = result.scalars().first()
            
            if mapping:
                continue
                
            try:
                # Check ERPNext
                item = await erp_client.get_item(sku)
                if not item:
                    # Create in ERPNext
                    payload = {
                        "item_code": sku,
                        "item_name": sku,
                        "item_group": "Products",
                        "is_stock_item": 1,
                        "is_sales_item": 1,
                        "include_item_in_manufacturing": 1,
                        "stock_uom": "Nos"
                    }
                    item = await erp_client.create_item(payload)
                
                # Save mapping with the actual ERP item code (primary key)
                erp_code = item.get("name") if item else sku
                new_mapping = MapShopifySkuErpItem(
                    shopify_sku=sku,
                    erp_item_code=erp_code
                )
                db.add(new_mapping)
                
            except httpx.HTTPStatusError as e:
                # Exception: ERPNext item creation failed
                error_response = e.response.text if hasattr(e, "response") else str(e)
                ex = ExceptionQueue(
                    error_type="ERP_ITEM_CREATION_FAILED",
                    related_sku=sku,
                    description=f"Failed to create item in ERPNext. Response: {error_response}",
                    status=ExceptionStatus.OPEN
                )
                db.add(ex)
                exceptions.append({"type": "ERP_ITEM_CREATION_FAILED", "sku": sku})
                
        await db.commit()
        
        # Only log successful mappings
        failed_skus = [exc["sku"] for exc in exceptions if exc["type"] == "ERP_ITEM_CREATION_FAILED"]
        successful_skus = [sku for sku in classified_skus if sku not in failed_skus]
        
        if successful_skus:
            from app.models import ActivityLog, ActivityType
            stmt_m = select(MapShopifySkuErpItem).where(MapShopifySkuErpItem.shopify_sku.in_(successful_skus))
            res_m = await db.execute(stmt_m)
            item_codes = [m.erp_item_code for m in res_m.scalars().all()] or successful_skus

            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="Item Master",
                title="ERP Item Verification",
                description=f"Verified {len(successful_skus)} mapped ERP items: {', '.join(successful_skus)}",
                doc_reference=", ".join(item_codes),
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()
    
    await erp_client.close()

    return {
        "classified_skus": classified_skus,
        "exceptions": exceptions
    }
