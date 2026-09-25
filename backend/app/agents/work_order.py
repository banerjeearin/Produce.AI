import httpx
from sqlalchemy.future import select
from app.db.session import AsyncSessionLocal
from app.models import StgWorkOrderPlan, WorkOrderStatus, ExceptionQueue, ExceptionStatus, ActivityLog, ActivityType
from app.agents.state import AgentState
from app.services.erpnext_client import ERPNextClient
from datetime import datetime

async def work_order_agent(state: AgentState) -> AgentState:
    """
    Work Order Agent:
    Reads PENDING work order plans and creates them in ERPNext.
    """
    planning_date = state.get("planning_date", datetime.utcnow().date())
    exceptions = state.get("exceptions", [])
    
    erp_client = ERPNextClient()
    
    async with AsyncSessionLocal() as db:
        stmt = select(StgWorkOrderPlan).where(
            StgWorkOrderPlan.planning_date == planning_date,
            StgWorkOrderPlan.status == WorkOrderStatus.PENDING
        )
        result = await db.execute(stmt)
        plans = result.scalars().all()
        
        created_orders = []
        for plan in plans:
            try:
                # Need BOM to create WO, we can get default BOM
                bom = await erp_client.get_bom(plan.erp_fg_item_code)
                if not bom:
                    raise Exception("Default BOM not found at Work Order creation step.")
                    
                payload = {
                    "production_item": plan.erp_fg_item_code,
                    "bom_no": bom.get("name"),
                    "qty": plan.net_qty,
                    "planned_start_date": planning_date.strftime("%d.%m.%Y")
                }
                
                wo = await erp_client.create_work_order(payload)
                
                plan.erp_work_order_id = wo.get("name")
                plan.status = WorkOrderStatus.CREATED
                created_orders.append(wo.get("name"))
                
            except httpx.HTTPStatusError as e:
                plan.status = WorkOrderStatus.FAILED
                ex = ExceptionQueue(
                    error_type="ERP_WO_CREATION_FAILED",
                    related_sku=plan.erp_fg_item_code,
                    description=f"Failed to create Work Order in ERPNext: {str(e)}",
                    status=ExceptionStatus.OPEN
                )
                db.add(ex)
                exceptions.append({"type": "ERP_WO_CREATION_FAILED", "sku": plan.erp_fg_item_code})
            except Exception as e:
                plan.status = WorkOrderStatus.FAILED
                ex = ExceptionQueue(
                    error_type="ERP_WO_CREATION_FAILED",
                    related_sku=plan.erp_fg_item_code,
                    description=str(e),
                    status=ExceptionStatus.OPEN
                )
                db.add(ex)
                exceptions.append({"type": "ERP_WO_CREATION_FAILED", "sku": plan.erp_fg_item_code})
                
        await db.commit()
        
        if created_orders:
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="Work Order",
                title="Work Orders Generated",
                description=f"Created {len(created_orders)} work orders in ERPNext: {', '.join(created_orders)}",
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()
    
    await erp_client.close()

    return {"exceptions": exceptions}
