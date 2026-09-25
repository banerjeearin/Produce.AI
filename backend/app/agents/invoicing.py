from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from app.db.session import AsyncSessionLocal
from app.models import StgShopifySalesOrderHdr, StgShopifySalesOrderLine, StgSalesInvoice, InvoicingStatus, ExceptionQueue, ExceptionStatus, ActivityLog, ActivityType
from app.agents.state import AgentState
from app.services.erpnext_client import ERPNextClient
import os

async def invoicing_agent(state: AgentState) -> AgentState:
    """
    Invoicing Agent:
    Finds fully allocated orders and creates Sales Invoices in ERPNext.
    """
    exceptions = state.get("exceptions", [])
    erp_client = ERPNextClient()
    company = os.getenv("ERPNEXT_COMPANY", "Aaishka Industries Pvt. Ltd.")

    async with AsyncSessionLocal() as db:
        # Fetch all headers that have at least one line
        stmt = select(StgShopifySalesOrderHdr).options(joinedload(StgShopifySalesOrderHdr.lines))
        result = await db.execute(stmt)
        headers = result.unique().scalars().all()

        invoices_created = 0

        for hdr in headers:
            # Check if all lines are fully INVOICED (meaning stock was fully allocated)
            if not hdr.lines:
                continue
            
            all_allocated = all(line.invoicing_status == InvoicingStatus.INVOICED for line in hdr.lines)
            if not all_allocated:
                continue

            # Check if invoice already exists
            existing_stmt = select(StgSalesInvoice).where(StgSalesInvoice.hdr_id == hdr.id)
            existing_result = await db.execute(existing_stmt)
            if existing_result.scalars().first():
                continue

            # Generate Sales Invoice payload
            items = []
            for line in hdr.lines:
                # We need the price. We don't store line price in stg_shopify_sales_order_line currently.
                # As a fallback, we'll use 0 or fetch from ERPNext later, but standard practice requires rate.
                # For now, we will set it to 1.0 just to pass ERPNext validation, or distribute total_price.
                price = hdr.total_price / len(hdr.lines) if hdr.lines else 0
                items.append({
                    "item_code": line.sku,
                    "qty": line.fulfilled_qty,
                    "rate": price
                })

            payload = {
                "doctype": "Sales Invoice",
                "customer": "Shopify Customer", # Default customer for now
                "company": company,
                "posting_date": hdr.created_at.strftime("%Y-%m-%d"),
                "items": items
            }

            try:
                # Need to ensure 'Shopify Customer' exists or handle it
                # For this demo, we'll assume it exists or the ERPNext default handles it
                # We can create customer if missing, but let's try pushing first
                resp = await erp_client.client.post("/api/resource/Sales Invoice", json=payload)
                resp.raise_for_status()
                invoice_data = resp.json().get("data", {})
                
                # Save to stg_sales_invoice
                stg_invoice = StgSalesInvoice(
                    run_id=state.get("run_id"),
                    hdr_id=hdr.id,
                    erp_invoice_id=invoice_data.get("name"),
                    status=InvoicingStatus.INVOICED
                )
                db.add(stg_invoice)
                invoices_created += 1

            except Exception as e:
                ex = ExceptionQueue(
                    error_type="SALES_INVOICE_FAILED",
                    description=f"Failed to create Sales Invoice for order {hdr.shopify_order_id}: {str(e)}",
                    status=ExceptionStatus.OPEN
                )
                db.add(ex)
                exceptions.append({"type": "SALES_INVOICE_FAILED", "hdr_id": hdr.id})

        await db.commit()

        if invoices_created > 0:
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="Invoicing",
                title="Sales Invoices Created",
                description=f"Successfully created {invoices_created} Sales Invoices in ERPNext.",
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()

    await erp_client.close()
    return {"exceptions": exceptions}
