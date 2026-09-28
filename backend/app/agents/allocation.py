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
    
    # 1. Fetch current stock balance from the synced ERPNext Stock Balance report
    # Use the ERPNext Item ID (item_code) to determine the stock quantity, not material description.
    stock_balances = {}
    try:
        from datetime import datetime
        today_str = datetime.now().strftime("%Y-%m-%d")
        stock_report = await erp_client.get_stock_balance_report(today_str, company=company)
        stock_dict = {}
        for r in stock_report:
            if isinstance(r, dict) and r.get("item_code"):
                code = str(r.get("item_code")).strip()
                qty = float(r.get("bal_qty", 0.0))
                stock_dict[code] = qty
                    
        # Check mapping from MapShopifySkuErpItem
        from app.models import MapShopifySkuErpItem
        async with AsyncSessionLocal() as db_map:
            stmt_m = select(MapShopifySkuErpItem).where(MapShopifySkuErpItem.shopify_sku.in_(classified_skus))
            res_m = await db_map.execute(stmt_m)
            mappings = {m.shopify_sku: m.erp_item_code for m in res_m.scalars().all()}
            
        for sku in classified_skus:
            erp_item_id = mappings.get(sku)
            if not erp_item_id:
                # Fallback to ERPNext lookup
                matched = await erp_client.get_item(sku)
                if matched:
                    erp_item_id = matched.get("name")
            
            erp_code_str = str(erp_item_id or sku).strip()
            # Determine stock strictly using ERPNext Item ID
            qty = stock_dict.get(erp_code_str, 0.0)
            stock_balances[sku] = max(0.0, qty)
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
            .where(StgShopifySalesOrderHdr.run_id == state.get("run_id"))
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
                # Fully fulfillable from stock
                line.fulfilled_qty = ordered_qty
                line.unfulfilled_qty = 0
                line.invoicing_status = InvoicingStatus.INVOICED # Ready for sales invoice
                stock_balances[sku] -= ordered_qty
                allocated_lines_count += 1
            elif available_stock > 0:
                # Partially fulfillable
                alloc = int(available_stock)
                line.fulfilled_qty = alloc
                line.unfulfilled_qty = ordered_qty - alloc
                line.invoicing_status = InvoicingStatus.PARTIAL
                stock_balances[sku] -= alloc
                partial_lines_count += 1
            else:
                # Completely unfulfillable -> requires manufacturing
                line.fulfilled_qty = 0
                line.unfulfilled_qty = ordered_qty
                # Remains PENDING for invoicing until manufactured
                unallocated_lines_count += 1
                
        await db.commit()

        if lines:
            alloc_summary = f"{allocated_lines_count} Fulfilled / {unallocated_lines_count + partial_lines_count} Shortage"
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="Allocation",
                title="Stock Allocation Check",
                description=f"Evaluated {len(lines)} lines: {allocated_lines_count} In-Stock (Direct Invoicing), {partial_lines_count} Partial, {unallocated_lines_count} Shortage (To Manufacture).",
                doc_reference=alloc_summary,
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()

        has_shortage = (unallocated_lines_count > 0 or partial_lines_count > 0)
        has_in_stock = (allocated_lines_count > 0 or partial_lines_count > 0)

    return {
        "needs_manufacturing": has_shortage,
        "has_shortage": has_shortage,
        "has_in_stock": has_in_stock
    }
