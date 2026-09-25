import httpx
from sqlalchemy.future import select
from app.db.session import AsyncSessionLocal
from app.models import BomRecipeMaster, ExceptionQueue, ExceptionStatus
from app.agents.state import AgentState
from app.services.erpnext_client import ERPNextClient

async def bom_generation_agent(state: AgentState) -> AgentState:
    """
    BOM Generation Agent:
    Ensures a default BOM exists in ERPNext for each SKU, strictly using BomRecipeMaster.
    """
    classified_skus = state.get("classified_skus", [])
    exceptions = state.get("exceptions", [])
    
    erp_client = ERPNextClient()
    
    async with AsyncSessionLocal() as db:
        for sku in classified_skus:
            # Skip if we already logged a creation exception for this SKU
            if any(e.get("sku") == sku for e in exceptions):
                continue
                
            try:
                # Get mapped ERP code
                from app.models import MapShopifySkuErpItem
                stmt_map = select(MapShopifySkuErpItem).where(MapShopifySkuErpItem.shopify_sku == sku)
                res_map = await db.execute(stmt_map)
                mapping = res_map.scalars().first()
                if not mapping:
                    raise Exception(f"Mapping not found for {sku}")
                erp_code = mapping.erp_item_code
                
                # Check ERPNext for active default BOM
                bom = await erp_client.get_bom(erp_code)
                if bom:
                    continue
                    
                # Look up recipe locally
                stmt = select(BomRecipeMaster).where(BomRecipeMaster.fg_item_code == sku)
                result = await db.execute(stmt)
                recipe_lines = result.scalars().all()
                
                if not recipe_lines:
                    import os
                    from app.models import ActivityLog, ActivityType
                    import instructor
                    import anthropic
                    from pydantic import BaseModel, Field
                    from typing import List

                    class RecipeLine(BaseModel):
                        raw_material_code: str = Field(description="The ERPNext item_code of the raw material to use.")
                        qty: float = Field(description="The required quantity of this raw material.")
                        uom: str = Field(description="The Unit of Measure (UOM) for this raw material, e.g., 'Nos', 'm', 'kg'")

                    class BomRecipe(BaseModel):
                        lines: List[RecipeLine] = Field(description="The list of raw materials needed for this finished good.")
                    
                    try:
                        raw_materials = await erp_client.get_raw_materials()
                        if not raw_materials:
                            raise Exception("No Raw Materials found in ERPNext to propose a recipe.")
                        
                        # Initialize instructor with Anthropic
                        anthropic_client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
                        instructor_client = instructor.from_anthropic(anthropic_client)
                        
                        prompt = f"Propose a reasonable Bill of Materials (BOM) recipe for the SKU: '{sku}'.\n\nYou MUST ONLY select from the following available raw materials in ERPNext:\n"
                        for rm in raw_materials:
                            prompt += f"- {rm.get('item_code')} (Name: {rm.get('item_name')}, UOM: {rm.get('stock_uom')})\n"
                            
                        prompt += "\nOutput the selected raw materials and quantities required to produce 1 unit of the finished good. You MUST ONLY output the JSON structured data."
                        
                        recipe_proposal = await instructor_client.messages.create(
                            model="claude-3-haiku-20240307",
                            max_tokens=1024,
                            messages=[{"role": "user", "content": prompt}],
                            response_model=BomRecipe
                        )
                        
                        # Insert proposed recipe into DB
                        recipe_lines = []
                        for line in recipe_proposal.lines:
                            new_recipe_line = BomRecipeMaster(
                                fg_item_code=sku,
                                raw_material_code=line.raw_material_code,
                                qty=line.qty,
                                uom=line.uom
                            )
                            db.add(new_recipe_line)
                            recipe_lines.append(new_recipe_line)
                        
                        await db.flush()
                        
                        # Log activity
                        log = ActivityLog(
                            run_id=state.get("run_id"),
                            agent_name="BOM Generation",
                            title="AI Proposed BOM Recipe",
                            description=f"AI proposed and saved a new BOM recipe for {sku}.",
                            type=ActivityType.INFO
                        )
                        db.add(log)
                        
                    except Exception as llm_err:
                        # Exception: Missing Recipe (fallback if LLM fails)
                        ex = ExceptionQueue(
                            error_type="MISSING_BOM_RECIPE",
                            related_sku=sku,
                            description=f"No BOM recipe found and AI proposal failed for {sku}. Error: {str(llm_err)}",
                            status=ExceptionStatus.OPEN
                        )
                        db.add(ex)
                        exceptions.append({"type": "MISSING_BOM_RECIPE", "sku": sku})
                        continue
                
                items_payload = []
                missing_rm = False
                for line in recipe_lines:
                    rm_code = line.raw_material_code
                    # Verify RM exists in ERP
                    rm_item = await erp_client.get_item(rm_code)
                    if not rm_item:
                        ex = ExceptionQueue(
                            error_type="MISSING_RAW_MATERIAL",
                            related_sku=sku,
                            description=f"Raw material {rm_code} does not exist in ERPNext.",
                            status=ExceptionStatus.OPEN
                        )
                        db.add(ex)
                        exceptions.append({"type": "MISSING_RAW_MATERIAL", "sku": sku, "rm": rm_code})
                        missing_rm = True
                        break
                    
                    actual_rm_code = rm_item.get("name")
                    items_payload.append({
                        "item_code": actual_rm_code,
                        "qty": line.qty,
                        "uom": line.uom
                    })
                
                if missing_rm:
                    continue
                    
                # Create BOM
                payload = {
                    "item": erp_code,
                    "is_active": 1,
                    "is_default": 1,
                    "items": items_payload
                }
                await erp_client.create_bom(payload)
                
            except Exception as e:
                # Exception: ERPNext BOM creation failed
                import httpx
                err_msg = str(e)
                if isinstance(e, httpx.HTTPStatusError):
                    err_msg = e.response.text if hasattr(e, 'response') else str(e)
                ex = ExceptionQueue(
                    error_type="ERP_BOM_CREATION_FAILED",
                    related_sku=sku,
                    description=f"Failed to create BOM in ERPNext: {err_msg}",
                    status=ExceptionStatus.OPEN
                )
                db.add(ex)
                exceptions.append({"type": "ERP_BOM_CREATION_FAILED", "sku": sku})
                
        await db.commit()
        
        if classified_skus:
            from app.models import ActivityLog, ActivityType
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="BOM Generation",
                title="BOM Verified",
                description=f"Verified BOMs for {len(classified_skus)} ERP items: {', '.join(list(classified_skus))}",
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()
    
    await erp_client.close()

    return {"exceptions": exceptions}
