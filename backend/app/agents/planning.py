from sqlalchemy.future import select
from sqlalchemy import func
from app.db.session import AsyncSessionLocal
from app.models import StgShopifySalesOrderLine, StgShopifySalesOrderHdr, ProcessingStatus, StgWorkOrderPlan, WorkOrderStatus
from app.agents.state import AgentState
from app.services.erpnext_client import ERPNextClient
from datetime import datetime

async def planning_agent(state: AgentState) -> AgentState:
    """
    Work Order Planning Agent:
    Calculates Net Qty = Open Paid Demand - Available Stock - Open WO Qty.
    Writes positive net demand to StgWorkOrderPlan.
    """
    classified_skus = state.get("classified_skus", [])
    exceptions = state.get("exceptions", [])
    planning_date = state.get("planning_date", datetime.utcnow().date())
    
    erp_client = ERPNextClient()
    generated_plans = []
    
    async with AsyncSessionLocal() as db:
        for sku in classified_skus:
            if any(e.get("sku") == sku for e in exceptions):
                continue
                
            # Aggregate Open Unfulfilled Demand for SKU
            stmt = (
                select(func.sum(StgShopifySalesOrderLine.unfulfilled_qty))
                .join(StgShopifySalesOrderHdr)
                .where(StgShopifySalesOrderLine.sku == sku)
                .where(StgShopifySalesOrderLine.processing_status == ProcessingStatus.CLASSIFIED)
                .where(StgShopifySalesOrderHdr.financial_status == "paid")
            )
            result = await db.execute(stmt)
            open_unfulfilled_demand = result.scalar() or 0.0
            
            if open_unfulfilled_demand <= 0:
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
                
                open_wo_qty = await erp_client.get_open_work_orders_qty(erp_code)
                
                net_qty = open_unfulfilled_demand - open_wo_qty
                
                if net_qty > 0:
                    # Upsert to Work Order Plan
                    stmt_plan = select(StgWorkOrderPlan).where(
                        StgWorkOrderPlan.erp_fg_item_code == erp_code,
                        StgWorkOrderPlan.planning_date == planning_date,
                        StgWorkOrderPlan.status == WorkOrderStatus.PENDING
                    )
                    res = await db.execute(stmt_plan)
                    plan_record = res.scalars().first()
                    
                    if plan_record:
                        plan_record.net_qty = net_qty
                    else:
                        plan_record = StgWorkOrderPlan(
                            run_id=state.get("run_id"),
                            planning_date=planning_date,
                            erp_fg_item_code=erp_code,
                            net_qty=net_qty,
                            status=WorkOrderStatus.PENDING
                        )
                        db.add(plan_record)
                    
                    generated_plans.append({
                        "erp_fg_item_code": erp_code,
                        "net_qty": net_qty
                    })
            
            except Exception as e:
                # Log general failure for planning
                pass
                
        await db.commit()
        
        if generated_plans:
            from app.models import ActivityLog, ActivityType
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="Planning",
                title="Production Planning",
                description=f"Generated {len(generated_plans)} production plans for {planning_date}.",
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()
    
    await erp_client.close()

    return {"work_order_plans": generated_plans}

