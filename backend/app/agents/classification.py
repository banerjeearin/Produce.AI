from sqlalchemy.future import select
from app.db.session import AsyncSessionLocal
from app.models import StgShopifySalesOrderLine, ProcessingStatus, ExceptionQueue, ExceptionStatus
from app.agents.state import AgentState

async def classification_agent(state: AgentState) -> AgentState:
    """
    Classification Agent:
    Validates SKUs and marks lines as CLASSIFIED. Flags missing SKUs as exceptions.
    """
    classified_skus = set(state.get("classified_skus", []))
    exceptions = state.get("exceptions", [])
    
    async with AsyncSessionLocal() as db:
        # Fetch PENDING lines for this run
        from app.models import StgShopifySalesOrderHdr
        stmt = (
            select(StgShopifySalesOrderLine)
            .join(StgShopifySalesOrderLine.header)
            .where(StgShopifySalesOrderHdr.run_id == state.get("run_id"))
            .where(StgShopifySalesOrderLine.processing_status == ProcessingStatus.PENDING)
        )
        result = await db.execute(stmt)
        pending_lines = result.scalars().all()
        
        for line in pending_lines:
            sku = line.sku
            if not sku or sku.strip() == "":
                # Exception: Missing SKU
                line.processing_status = ProcessingStatus.ERROR
                ex = ExceptionQueue(
                    error_type="MISSING_SKU",
                    description=f"Line ID {line.id} has no SKU.",
                    status=ExceptionStatus.OPEN
                )
                db.add(ex)
                exceptions.append({"type": "MISSING_SKU", "line_id": line.id})
            else:
                line.processing_status = ProcessingStatus.CLASSIFIED
                classified_skus.add(sku)
                
        erp_material_codes = []
        from app.models import MapShopifySkuErpItem
        from app.services.erpnext_client import ERPNextClient
        erp_client = ERPNextClient()
        
        try:
            # Build title lookup for intelligent matching
            sku_titles = {}
            for order in state.get("raw_orders", []):
                for line in order.get("line_items", []):
                    s = line.get("sku") or line.get("name")
                    t = line.get("title") or line.get("name") or ""
                    if s and s not in sku_titles:
                        sku_titles[s] = t
                        
            for sku in classified_skus:
                # 1. Check local MapShopifySkuErpItem table
                stmt_map = select(MapShopifySkuErpItem).where(MapShopifySkuErpItem.shopify_sku == sku)
                res_map = await db.execute(stmt_map)
                mapping = res_map.scalars().first()
                
                if mapping:
                    erp_material_codes.append(mapping.erp_item_code)
                else:
                    # 2. Resolve via ERPNext matcher
                    title = sku_titles.get(sku, "")
                    matched_item = await erp_client.get_item(sku, title=title)
                    if matched_item and matched_item.get("name"):
                        erp_code = matched_item.get("name")
                        new_map = MapShopifySkuErpItem(shopify_sku=sku, erp_item_code=erp_code)
                        db.add(new_map)
                        erp_material_codes.append(erp_code)
                    else:
                        erp_material_codes.append(sku)
        finally:
            await erp_client.close()
            
        await db.commit()
        
        if pending_lines:
            from app.models import ActivityLog, ActivityType
            doc_ref = ", ".join(erp_material_codes) if erp_material_codes else ", ".join(list(classified_skus))
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="Classification",
                title="Orders Classified & Mapped to ERPNext",
                description=f"Classified {len(pending_lines)} order lines. Mapped ERP Items: {', '.join(erp_material_codes)}",
                doc_reference=doc_ref,
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()

    return {
        "classified_skus": list(classified_skus),
        "erp_material_codes": erp_material_codes,
        "exceptions": exceptions
    }
