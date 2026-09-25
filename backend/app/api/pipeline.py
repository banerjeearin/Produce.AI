from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from app.agents.orchestrator import run_pipeline, resume_pipeline, get_pipeline_state
from app.services.shopify_client import fetch_shopify_orders
import uuid

router = APIRouter()

class PipelineRequest(BaseModel):
    date_from: Optional[str] = None # Expects DD.MM.YYYY
    date_to: Optional[str] = None # Expects DD.MM.YYYY

@router.post("/run")
async def trigger_pipeline(req: PipelineRequest, background_tasks: BackgroundTasks):
    def parse_date(date_str: str) -> Optional[datetime]:
        if not date_str:
            return None
        try:
            return datetime.strptime(date_str, "%d.%m.%Y")
        except ValueError:
            return None

    parsed_from = parse_date(req.date_from)
    parsed_to = parse_date(req.date_to)
    
    # 1. Fetch all orders matching criteria
    orders = await fetch_shopify_orders(parsed_from, parsed_to)
    
    if not orders:
        return {"message": "No orders found to process."}
        
    # 2. Spawn a separate pipeline run for each order
    run_ids = []
    for order in orders:
        run_id = str(uuid.uuid4())
        run_ids.append(run_id)
        background_tasks.add_task(run_pipeline, run_id=run_id, raw_orders=[order], date_from=parsed_from, date_to=parsed_to)
        
    return {"message": f"Triggered {len(orders)} individual pipeline runs.", "run_ids": run_ids}

@router.get("/runs/{run_id}/state")
async def get_run_state(run_id: str):
    """
    Returns the current LangGraph state for a given run_id.
    """
    snapshot = await get_pipeline_state(run_id)
    if not snapshot:
        return {"status": "NOT_FOUND"}
    
    return {
        "status": "PAUSED" if len(snapshot.next) > 0 else "COMPLETED",
        "next_nodes": list(snapshot.next),
        "values": snapshot.values
    }

@router.post("/runs/{run_id}/resume")
async def resume_run(run_id: str):
    """
    Resumes a paused pipeline thread synchronously so the frontend can get the updated state immediately.
    """
    await resume_pipeline(run_id)
    return {"message": f"Resumed pipeline for run {run_id}"}

@router.delete("/runs/{run_id}")
async def delete_run_data(run_id: str):
    """
    Deletes all ingested data (raw, hdr, lines, work plans, and logs) for a specific run_id.
    """
    from sqlalchemy import delete, select
    from app.db.session import AsyncSessionLocal
    from app.models import (
        StgShopifySalesOrderLine, StgShopifySalesOrderHdr, ShopifyOrderRaw, 
        StgWorkOrderPlan, ActivityLog
    )

    async with AsyncSessionLocal() as db:
        try:
            # 1. Get header IDs for this run to delete lines
            res_hdr = await db.execute(select(StgShopifySalesOrderHdr.id).where(StgShopifySalesOrderHdr.run_id == run_id))
            hdr_ids = [r[0] for r in res_hdr.all()]
            
            if hdr_ids:
                stmt_lines = delete(StgShopifySalesOrderLine).where(StgShopifySalesOrderLine.hdr_id.in_(hdr_ids))
                await db.execute(stmt_lines)

            # 2. Delete headers for run
            stmt_hdr = delete(StgShopifySalesOrderHdr).where(StgShopifySalesOrderHdr.run_id == run_id)
            await db.execute(stmt_hdr)
            
            # 3. Delete raw orders for run
            stmt_raw = delete(ShopifyOrderRaw).where(ShopifyOrderRaw.run_id == run_id)
            await db.execute(stmt_raw)
            
            # 3.5 Delete sales invoices for run
            from app.models import StgSalesInvoice
            stmt_inv = delete(StgSalesInvoice).where(StgSalesInvoice.run_id == run_id)
            await db.execute(stmt_inv)
            
            # 4. Delete work plans for run
            stmt_plans = delete(StgWorkOrderPlan).where(StgWorkOrderPlan.run_id == run_id)
            await db.execute(stmt_plans)
            
            # 5. Delete activity logs for run
            stmt_logs = delete(ActivityLog).where(ActivityLog.run_id == run_id)
            await db.execute(stmt_logs)

            await db.commit()
            return {"message": f"Successfully deleted all data for run {run_id}"}
            
        except Exception as e:
            await db.rollback()
            return {"error": str(e)}
