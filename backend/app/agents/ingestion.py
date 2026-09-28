import logging
from datetime import datetime
from sqlalchemy.future import select
from app.db.session import AsyncSessionLocal
from app.models import ShopifyOrderRaw, StgShopifySalesOrderHdr, StgShopifySalesOrderLine, ProcessingStatus
from app.agents.state import AgentState

logger = logging.getLogger(__name__)

async def ingestion_agent(state: AgentState) -> AgentState:
    """
    Ingestion Agent:
    Takes raw orders from the state, inserts them into staging tables.
    Checks for duplicates and updates financial status if it changed.
    Uses date_from and date_to for filtering (when connecting to real API).
    """
    raw_orders = state.get("raw_orders", [])
    staged_ids = state.get("staged_order_ids", [])
    date_from = state.get("date_from")
    date_to = state.get("date_to")
    
    if not raw_orders:
        logger.info(f"No raw_orders in state, nothing to ingest.")
        return {"staged_order_ids": staged_ids, "raw_orders": raw_orders}
    
    logger.info(f"Ingesting orders from {date_from} to {date_to}")
    
    async with AsyncSessionLocal() as db:
        for order in raw_orders:
            # We now process ALL orders (paid or unpaid)
            financial_status = order.get("financial_status") or ""
            financial_status = financial_status.lower()
            order_id = str(order.get("id"))
            
            # Check if we already staged this order
            stmt = select(ShopifyOrderRaw).where(ShopifyOrderRaw.shopify_order_id == order_id)
            result = await db.execute(stmt)
            existing_raw = result.scalars().first()
            
            if existing_raw:
                # Update existing raw and header with current run_id and financial status
                existing_raw.run_id = state.get("run_id")
                stmt_hdr = select(StgShopifySalesOrderHdr).where(StgShopifySalesOrderHdr.shopify_order_id == order_id)
                res_hdr = await db.execute(stmt_hdr)
                existing_hdr = res_hdr.scalars().first()
                if existing_hdr:
                    existing_hdr.run_id = state.get("run_id")
                    existing_hdr.financial_status = financial_status
                    staged_ids.append(existing_hdr.id)
                    stmt_lines = select(StgShopifySalesOrderLine).where(StgShopifySalesOrderLine.hdr_id == existing_hdr.id)
                    res_lines = await db.execute(stmt_lines)
                    for line in res_lines.scalars().all():
                        line.processing_status = ProcessingStatus.PENDING
                continue
                
            # 1. Insert Raw
            raw_record = ShopifyOrderRaw(
                run_id=state.get("run_id"),
                shopify_order_id=order_id,
                raw_payload=order
            )
            db.add(raw_record)
            
            # Extract Customer & Shipping Info
            customer = order.get("customer") or {}
            customer_name = f"{customer.get('first_name', '')} {customer.get('last_name', '')}".strip() or order.get("email") or "Shopify Customer"
            shipping_address = order.get("shipping_address") or order.get("billing_address") or {}
            shipping_state = shipping_address.get("province") or ""
            company_state = "Maharashtra" # Aaishka Industries state
            is_intra_state = bool(shipping_state and (shipping_state.strip().lower() == company_state.lower() or shipping_state.strip().upper() == "MH"))

            total_price = float(order.get("total_price", 0.0))
            total_discount = float(order.get("total_discounts", 0.0))
            total_tax = float(order.get("total_tax", 0.0))

            created_at_str = order.get("created_at")
            if created_at_str:
                try:
                    order_created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                except Exception:
                    order_created_at = datetime.utcnow()
            else:
                order_created_at = datetime.utcnow()

            order_number = str(order.get("order_number") or str(order.get("name", "")).lstrip("#") or order_id)

            # 2. Insert Header
            hdr_record = StgShopifySalesOrderHdr(
                run_id=state.get("run_id"),
                shopify_order_id=order_id,
                order_number=order_number,
                customer_email=order.get("email"),
                customer_name=customer_name,
                shipping_state=shipping_state,
                total_price=total_price,
                total_discount=total_discount,
                total_tax=total_tax,
                financial_status=financial_status,
                created_at=order_created_at
            )
            db.add(hdr_record)
            await db.flush() # To get hdr_record.id
            
            # 3. Insert Lines with SKU, Quantity, Rate, Amount, Discount, and GST breakdown
            line_items = order.get("line_items", [])
            for item in line_items:
                sku = item.get("sku") or item.get("name")
                item_title = item.get("title") or item.get("name")
                qty = int(item.get("quantity", 0))
                rate = float(item.get("price", 0.0))
                gross_amt = rate * qty
                
                # Discount
                line_discount = float(item.get("total_discount", 0.0))
                if line_discount == 0.0 and item.get("discount_allocations"):
                    line_discount = sum(float(alloc.get("amount", 0.0)) for alloc in item.get("discount_allocations", []))
                net_amt = max(0.0, gross_amt - line_discount)
                
                # Taxes (Tax lines from Shopify item)
                tax_lines = item.get("tax_lines", [])
                line_tax = sum(float(tl.get("price", 0.0)) for tl in tax_lines)
                tax_rate = float(tax_lines[0].get("rate", 0.0)) if tax_lines else 0.0
                
                if is_intra_state:
                    gst_type = "CGST+SGST"
                    cgst_rate = tax_rate / 2.0
                    sgst_rate = tax_rate / 2.0
                    igst_rate = 0.0
                    cgst_amount = round(line_tax / 2.0, 2)
                    sgst_amount = round(line_tax / 2.0, 2)
                    igst_amount = 0.0
                else:
                    gst_type = "IGST"
                    cgst_rate = 0.0
                    sgst_rate = 0.0
                    igst_rate = tax_rate
                    cgst_amount = 0.0
                    sgst_amount = 0.0
                    igst_amount = round(line_tax, 2)
                
                line_record = StgShopifySalesOrderLine(
                    hdr_id=hdr_record.id,
                    sku=sku,
                    item_title=item_title,
                    quantity=qty,
                    rate=rate,
                    gross_amount=gross_amt,
                    discount_amount=line_discount,
                    net_amount=net_amt,
                    gst_rate=tax_rate,
                    gst_type=gst_type,
                    cgst_rate=cgst_rate,
                    cgst_amount=cgst_amount,
                    sgst_rate=sgst_rate,
                    sgst_amount=sgst_amount,
                    igst_rate=igst_rate,
                    igst_amount=igst_amount,
                    total_tax=line_tax,
                    price=rate,
                    processing_status=ProcessingStatus.PENDING
                )
                db.add(line_record)
            
            staged_ids.append(hdr_record.id)
            
        # Log Activity unconditionally
        from app.models import ActivityLog, ActivityType
        order_refs = [str(o.get('name') or f"#{o.get('order_number')}" or o.get('id')) for o in raw_orders]
        log = ActivityLog(
            run_id=state.get("run_id"),
            agent_name="Ingestion",
            title=f"Pipeline Run Started ({date_from or 'All Time'})",
            description=f"Fetched {len(raw_orders)} orders from Shopify: {', '.join([str(o.get('id')) for o in raw_orders])}",
            doc_reference=", ".join(order_refs),
            type=ActivityType.INFO
        )
        db.add(log)
            
        await db.commit()

    return {"staged_order_ids": staged_ids, "raw_orders": raw_orders}
