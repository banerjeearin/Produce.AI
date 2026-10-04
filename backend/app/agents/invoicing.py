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
        # Fetch headers for this run that have lines
        stmt = (
            select(StgShopifySalesOrderHdr)
            .options(joinedload(StgShopifySalesOrderHdr.lines))
            .where(StgShopifySalesOrderHdr.run_id == state.get("run_id"))
        )
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

            # Check mapping from MapShopifySkuErpItem with fallback to ERPNext lookup
            from app.models import MapShopifySkuErpItem
            hdr_skus = [l.sku for l in hdr.lines if l.sku]
            stmt_m = select(MapShopifySkuErpItem).where(MapShopifySkuErpItem.shopify_sku.in_(hdr_skus))
            res_m = await db.execute(stmt_m)
            mappings = {m.shopify_sku: m.erp_item_code for m in res_m.scalars().all()}
            for s in hdr_skus:
                if s not in mappings:
                    matched = await erp_client.get_item(s)
                    if matched:
                        mappings[s] = matched.get("name")

            # State and GST mapping
            state_code_map = {
                "jammu and kashmir": "01-Jammu and Kashmir",
                "himachal pradesh": "02-Himachal Pradesh",
                "punjab": "03-Punjab",
                "chandigarh": "04-Chandigarh",
                "uttarakhand": "05-Uttarakhand",
                "haryana": "06-Haryana",
                "delhi": "07-Delhi",
                "rajasthan": "08-Rajasthan",
                "uttar pradesh": "09-Uttar Pradesh",
                "bihar": "10-Bihar",
                "sikkim": "11-Sikkim",
                "arunachal pradesh": "12-Arunachal Pradesh",
                "nagaland": "13-Nagaland",
                "manipur": "14-Manipur",
                "mizoram": "15-Mizoram",
                "tripura": "16-Tripura",
                "meghalaya": "17-Meghalaya",
                "assam": "18-Assam",
                "west bengal": "19-West Bengal",
                "jharkhand": "20-Jharkhand",
                "odisha": "21-Odisha",
                "chhattisgarh": "22-Chhattisgarh",
                "madhya pradesh": "23-Madhya Pradesh",
                "gujarat": "24-Gujarat",
                "daman and diu": "25-Daman and Diu",
                "dadra and nagar haveli": "26-Dadra and Nagar Haveli",
                "maharashtra": "27-Maharashtra",
                "andhra pradesh": "28-Andhra Pradesh",
                "karnataka": "29-Karnataka",
                "goa": "30-Goa",
                "lakshadweep": "31-Lakshadweep",
                "kerala": "32-Kerala",
                "tamil nadu": "33-Tamil Nadu",
                "puducherry": "34-Puducherry",
                "andaman and nicobar islands": "35-Andaman and Nicobar Islands",
                "telangana": "36-Telangana",
                "ladakh": "38-Ladakh"
            }

            shipping_state_str = (hdr.shipping_state or "Maharashtra").strip().lower()
            place_of_supply = state_code_map.get(shipping_state_str, "27-Maharashtra")
            is_intra = (shipping_state_str in ["maharashtra", "mh"])

            # Generate Sales Invoice payload with complete extracted fields
            items = []
            max_tax_rate = 0.0
            for line in hdr.lines:
                if line.fulfilled_qty <= 0:
                    continue
                item_code = mappings.get(line.sku, line.sku)
                
                tax_rate_dec = (line.gst_rate or 0.0)
                if tax_rate_dec > 0:
                    max_tax_rate = max(max_tax_rate, tax_rate_dec * 100.0)

                # Shopify prices are tax inclusive (price - discount). Calculate pre-tax base price and discount.
                shopify_unit_price = line.rate if (line.rate and line.rate > 0) else line.price
                tax_multiplier = (1.0 + tax_rate_dec) if tax_rate_dec > 0 else 1.0

                base_price_list_rate = round(shopify_unit_price / tax_multiplier, 2)
                
                shopify_discount = line.discount_amount or 0.0
                if shopify_discount > 0:
                    base_discount_amount = round(shopify_discount / tax_multiplier, 2)
                    base_rate = round((shopify_unit_price - shopify_discount) / tax_multiplier, 2)
                else:
                    base_discount_amount = 0.0
                    base_rate = base_price_list_rate

                item_dict = {
                    "item_code": item_code,
                    "qty": line.fulfilled_qty,
                    "price_list_rate": base_price_list_rate,
                    "rate": base_rate,
                    "warehouse": "Finished Goods - AIPL"
                }
                if base_discount_amount > 0:
                    item_dict["discount_amount"] = base_discount_amount
                
                items.append(item_dict)

            if not items:
                continue

            # Construct Taxes and Charges Table (on base net total)
            taxes_list = []
            if is_intra:
                tax_category = "In-State"
                taxes_template = "Output GST In-state - AIPL"
                half_rate = max_tax_rate / 2.0 if max_tax_rate > 0 else 2.5
                taxes_list = [
                    {
                        "charge_type": "On Net Total",
                        "account_head": "Output Tax CGST - AIPL",
                        "description": "CGST",
                        "rate": half_rate,
                        "cost_center": "Main - AIPL",
                        "included_in_print_rate": 0
                    },
                    {
                        "charge_type": "On Net Total",
                        "account_head": "Output Tax SGST - AIPL",
                        "description": "SGST",
                        "rate": half_rate,
                        "cost_center": "Main - AIPL",
                        "included_in_print_rate": 0
                    }
                ]
            else:
                tax_category = "Out-State"
                taxes_template = "Output GST Out-state - AIPL"
                tax_pct = max_tax_rate if max_tax_rate > 0 else 12.0
                taxes_list = [
                    {
                        "charge_type": "On Net Total",
                        "account_head": "Output Tax IGST - AIPL",
                        "description": "IGST",
                        "rate": tax_pct,
                        "cost_center": "Main - AIPL",
                        "included_in_print_rate": 0
                    }
                ]

            posting_date_str = hdr.created_at.strftime("%Y-%m-%d")
            posting_time_str = hdr.created_at.strftime("%H:%M:%S")

            payload = {
                "doctype": "Sales Invoice",
                "customer": "Shopify Default Customer",
                "company": company,
                "set_posting_time": 1,
                "posting_date": posting_date_str,
                "posting_time": posting_time_str,
                "po_no": str(hdr.order_number or hdr.shopify_order_id),
                "po_date": posting_date_str,
                "update_stock": 1,
                "tax_category": tax_category,
                "place_of_supply": place_of_supply,
                "taxes_and_charges": taxes_template,
                "taxes": taxes_list,
                "items": items
            }

            try:
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
                err_detail = str(e)
                if hasattr(e, "response") and getattr(e, "response", None) is not None:
                    try:
                        err_detail += f" - Response: {e.response.text}"
                    except Exception:
                        pass
                ex = ExceptionQueue(
                    error_type="SALES_INVOICE_FAILED",
                    description=f"Failed to create Sales Invoice for order {hdr.shopify_order_id}: {err_detail}",
                    status=ExceptionStatus.OPEN
                )
                db.add(ex)
                exceptions.append({"type": "SALES_INVOICE_FAILED", "hdr_id": hdr.id})

        # Check if there are any unfulfilled quantities remaining across lines
        from sqlalchemy import func
        res_shortage = await db.execute(
            select(func.sum(StgShopifySalesOrderLine.unfulfilled_qty))
            .join(StgShopifySalesOrderLine.header)
            .where(StgShopifySalesOrderHdr.run_id == state.get("run_id"))
        )
        total_shortage = res_shortage.scalar() or 0.0
        needs_manufacturing = total_shortage > 0

        await db.commit()

        if invoices_created > 0:
            stmt_inv_names = select(StgSalesInvoice.erp_invoice_id).where(StgSalesInvoice.run_id == state.get("run_id"))
            res_inv_names = await db.execute(stmt_inv_names)
            inv_nums = [inv for inv in res_inv_names.scalars().all() if inv]
            
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="Invoicing",
                title="Sales Invoices Created",
                description=f"Successfully created {invoices_created} Sales Invoices in ERPNext.",
                doc_reference=", ".join(inv_nums),
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()

    await erp_client.close()
    return {
        "exceptions": exceptions,
        "needs_manufacturing": needs_manufacturing
    }
