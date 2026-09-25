from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from app.db.session import AsyncSessionLocal
from app.models import StgShopifySalesOrderLine, StgShopifySalesOrderHdr, ProcessingStatus, InvoicingStatus, ActivityLog, ActivityType
from app.agents.state import AgentState
from app.services.erpnext_client import ERPNextClient
from datetime import datetime
import os

async def allocation_agent(state: AgentState) -> AgentState:
    """
    Allocation Agent:
    Checks stock and allocates available quantities to order lines chronologically.
    Updates fulfilled_qty and unfulfilled_qty on the line.
    """
    classified_skus = state.get("classified_skus", [])
    if not classified_skus:
        return state

    erp_client = ERPNextClient()
    company = os.getenv("ERPNEXT_COMPANY", "Aaishka Industries Pvt. Ltd.")
    
    # 1. Fetch current stock balance
    stock_balances = {}
    try:
        payload = {
            "report_name": "Stock Balance",
            "filters": {
                "company": company,
                "to_date": datetime.now().strftime("%Y-%m-%d")
            },
            "ignore_prepared_report": 1
        }
        resp = await erp_client.client.post("/api/method/frappe.desk.query_report.run", json=payload)
        data = resp.json()
        if "message" in data and "result" in data["message"]:
            for row in data["message"]["result"]:
                if isinstance(row, dict) and row.get("item_code"):
                    item_code = row["item_code"]
                    bal_qty = float(row.get("bal_qty", 0.0))
                    # Aggregate stock across warehouses
                    stock_balances[item_code] = stock_balances.get(item_code, 0.0) + bal_qty
    except Exception as e:
        print(f"Error fetching stock balance for allocation: {e}")
    finally:
        await erp_client.close()

    allocated_lines_count = 0
    partial_lines_count = 0
    unallocated_lines_count = 0

    async with AsyncSessionLocal() as db:
        # Fetch lines that need allocation, ordered chronologically by order created_at
        stmt = (
            select(StgShopifySalesOrderLine)
            .join(StgShopifySalesOrderLine.header)
            .options(joinedload(StgShopifySalesOrderLine.header))
            .where(StgShopifySalesOrderLine.processing_status == ProcessingStatus.CLASSIFIED)
            .where(StgShopifySalesOrderLine.invoicing_status == InvoicingStatus.PENDING)
            .order_by(StgShopifySalesOrderHdr.created_at.asc(), StgShopifySalesOrderLine.id.asc())
        )
        result = await db.execute(stmt)
        lines = result.scalars().all()

        for line in lines:
            sku = line.sku
            ordered_qty = line.quantity
            available_stock = stock_balances.get(sku, 0.0)

            if available_stock >= ordered_qty:
                # Fully fulfillable
                line.fulfilled_qty = ordered_qty
                line.unfulfilled_qty = 0
                line.invoicing_status = InvoicingStatus.INVOICED # Mark ready for invoicing
                stock_balances[sku] -= ordered_qty
                allocated_lines_count += 1
            elif available_stock > 0:
                # Partially fulfillable
                line.fulfilled_qty = int(available_stock)
                line.unfulfilled_qty = ordered_qty - int(available_stock)
                line.invoicing_status = InvoicingStatus.PARTIAL
                stock_balances[sku] -= int(available_stock)
                partial_lines_count += 1
            else:
                # Completely unfulfillable
                line.fulfilled_qty = 0
                line.unfulfilled_qty = ordered_qty
                # Remains PENDING for invoicing, waiting for manufacturing
                unallocated_lines_count += 1
                
        await db.commit()

        if lines:
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="Allocation",
                title="Stock Allocated",
                description=f"Processed {len(lines)} lines. Fully Allocated: {allocated_lines_count}, Partially Allocated: {partial_lines_count}, Unallocated (Shortage): {unallocated_lines_count}",
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()

    return state
