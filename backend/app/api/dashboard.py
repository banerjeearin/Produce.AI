from fastapi import APIRouter, HTTPException
from sqlalchemy.future import select
from sqlalchemy import func
from app.db.session import AsyncSessionLocal
from app.models import StgShopifySalesOrderHdr, StgWorkOrderPlan, ExceptionQueue, ActivityLog
from typing import Optional
from datetime import datetime
import os
import pytz

router = APIRouter()

def parse_date(date_str: Optional[str], end_of_day: bool = False) -> Optional[datetime]:
    if not date_str:
        return None
    try:
        tz = pytz.timezone(os.getenv("TIMEZONE", "Asia/Kolkata"))
        dt = datetime.strptime(date_str, "%d.%m.%Y")
        if end_of_day:
            dt = dt.replace(hour=23, minute=59, second=59)
        else:
            dt = dt.replace(hour=0, minute=0, second=0)
        return tz.localize(dt)
    except Exception as e:
        return None

@router.get("/stats")
async def get_stats(date_from: Optional[str] = None, date_to: Optional[str] = None):
    d_from = parse_date(date_from, end_of_day=False)
    d_to = parse_date(date_to, end_of_day=True)

    async with AsyncSessionLocal() as db:
        # Orders processed count
        stmt_orders = select(func.count(StgShopifySalesOrderHdr.id))
        if d_from:
            stmt_orders = stmt_orders.where(StgShopifySalesOrderHdr.created_at >= d_from)
        if d_to:
            stmt_orders = stmt_orders.where(StgShopifySalesOrderHdr.created_at <= d_to)
        orders_count = await db.scalar(stmt_orders)

        # Work orders created count
        stmt_wos = select(func.count(StgWorkOrderPlan.id)).where(StgWorkOrderPlan.status == 'CREATED')
        if d_from:
            stmt_wos = stmt_wos.where(StgWorkOrderPlan.planning_date >= d_from)
        if d_to:
            stmt_wos = stmt_wos.where(StgWorkOrderPlan.planning_date <= d_to)
        wos_created = await db.scalar(stmt_wos)

        # Open exceptions count
        stmt_ex = select(func.count(ExceptionQueue.id)).where(ExceptionQueue.status == 'OPEN')
        if d_from:
            stmt_ex = stmt_ex.where(ExceptionQueue.created_at >= d_from)
        if d_to:
            stmt_ex = stmt_ex.where(ExceptionQueue.created_at <= d_to)
        open_exceptions = await db.scalar(stmt_ex)
        
    return {
        "orders_processed": orders_count or 0,
        "work_orders_created": wos_created or 0,
        "open_exceptions": open_exceptions or 0
    }

@router.get("/activities")
async def get_activities(limit: int = 100, date_from: Optional[str] = None, date_to: Optional[str] = None):
    from app.models import ActivityLog
    d_from = parse_date(date_from, end_of_day=False)
    d_to = parse_date(date_to, end_of_day=True)

    async with AsyncSessionLocal() as db:
        try:
            stmt = select(ActivityLog)
            if d_from:
                # Filter by runs that started on/after date or header date
                # ActivityLog created_at can also be filtered or join on StgShopifySalesOrderHdr
                stmt = stmt.join(StgShopifySalesOrderHdr, StgShopifySalesOrderHdr.run_id == ActivityLog.run_id, isouter=True)
                stmt = stmt.where(
                    (StgShopifySalesOrderHdr.created_at >= d_from) | 
                    ((StgShopifySalesOrderHdr.id == None) & (ActivityLog.created_at >= d_from))
                )
            if d_to:
                if not d_from:
                    stmt = stmt.join(StgShopifySalesOrderHdr, StgShopifySalesOrderHdr.run_id == ActivityLog.run_id, isouter=True)
                stmt = stmt.where(
                    (StgShopifySalesOrderHdr.created_at <= d_to) |
                    ((StgShopifySalesOrderHdr.id == None) & (ActivityLog.created_at <= d_to))
                )

            stmt = stmt.order_by(ActivityLog.created_at.desc()).limit(limit)
            result = await db.execute(stmt)
            activities = result.scalars().all()
            return [{
                "title": a.title, 
                "description": a.description, 
                "doc_reference": a.doc_reference,
                "type": a.type, 
                "created_at": a.created_at, 
                "run_id": a.run_id, 
                "agent_name": a.agent_name
            } for a in activities]
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/exceptions")
async def get_exceptions():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ExceptionQueue).where(ExceptionQueue.status == 'OPEN').order_by(ExceptionQueue.id.desc()))
        exceptions = result.scalars().all()
        
    return [
        {
            "id": ex.id,
            "error_type": ex.error_type,
            "related_sku": ex.related_sku,
            "description": ex.description,
            "status": ex.status,
            "resolution_notes": ex.resolution_notes
        }
        for ex in exceptions
    ]

@router.post("/exceptions/{exception_id}/resolve")
async def resolve_exception(exception_id: int):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ExceptionQueue).where(ExceptionQueue.id == exception_id))
        ex = result.scalars().first()
        if ex:
            ex.status = 'RESOLVED'
            await db.commit()
            
            # Remove from LangGraph state memory
            if ex.run_id and ex.related_sku:
                from app.agents.orchestrator import graph, interrupts
                from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
                config = {"configurable": {"thread_id": ex.run_id}}
                async with AsyncSqliteSaver.from_conn_string("checkpoints.sqlite") as memory:
                    orchestrator = graph.compile(checkpointer=memory, interrupt_after=interrupts)
                    snapshot = await orchestrator.aget_state(config)
                    if snapshot and snapshot.values and "exceptions" in snapshot.values:
                        current_exceptions = snapshot.values["exceptions"]
                        new_exceptions = [e for e in current_exceptions if not (e.get("sku") == ex.related_sku and e.get("type") == ex.error_type)]
                        if len(new_exceptions) != len(current_exceptions):
                            await orchestrator.aupdate_state(config, {"exceptions": new_exceptions})

            return {"message": "Exception resolved"}
    raise HTTPException(status_code=404, detail="Exception not found")

@router.get("/inventory")
async def get_inventory(date: str = None):
    from datetime import datetime
    import os
    from fastapi import HTTPException
    from app.services.erpnext_client import ERPNextClient

    target_date = date or datetime.now().strftime("%Y-%m-%d")
    
    # Check if ERPNext is actually configured
    if not os.getenv("ERPNEXT_URL"):
        raise HTTPException(
            status_code=500, 
            detail="ERPNEXT_URL is not configured in your .env file! The system cannot fetch from the real ERP system until it is connected."
        )

    client = ERPNextClient()
    try:
        company = os.getenv("ERPNEXT_COMPANY")
        raw_results = await client.get_stock_balance_report(target_date, company=company)
        
        # Transform ERPNext report format into our frontend format
        inventory_data = []
        for row in raw_results:
            # Skip totals/grouping rows if they aren't dicts or don't have an item_code
            if not isinstance(row, dict) or not row.get("item_code"):
                continue
                
            inventory_data.append({
                "item_code": row.get("item_code"),
                "item_name": row.get("item_name", row.get("item_code")),
                "stock_type": "Stock", # Implicitly stock since it's on the ledger
                "quantity": float(row.get("bal_qty", 0.0)),
                "uom": row.get("stock_uom", "Nos")
            })
            
        return {
            "date": target_date,
            "data": inventory_data
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to fetch from ERPNext: {str(e)}")
    finally:
        await client.close()
