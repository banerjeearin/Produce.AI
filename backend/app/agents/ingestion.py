import logging
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
                # Update existing header if financial_status changed (e.g. pending -> paid)
                stmt_hdr = select(StgShopifySalesOrderHdr).where(StgShopifySalesOrderHdr.shopify_order_id == order_id)
                res_hdr = await db.execute(stmt_hdr)
                existing_hdr = res_hdr.scalars().first()
                if existing_hdr and existing_hdr.financial_status != financial_status:
                    existing_hdr.financial_status = financial_status
                continue # Skip re-inserting lines
                
            # 1. Insert Raw
            raw_record = ShopifyOrderRaw(
                run_id=state.get("run_id"),
                shopify_order_id=order_id,
                raw_payload=order
            )
            db.add(raw_record)
            
            # 2. Insert Header
            hdr_record = StgShopifySalesOrderHdr(
                run_id=state.get("run_id"),
                shopify_order_id=order_id,
                customer_email=order.get("email"),
                total_price=float(order.get("total_price", 0.0)),
                financial_status=financial_status
            )
            db.add(hdr_record)
            await db.flush() # To get hdr_record.id
            
            # 3. Insert Lines
            line_items = order.get("line_items", [])
            for item in line_items:
                line_record = StgShopifySalesOrderLine(
                    hdr_id=hdr_record.id,
                    sku=item.get("sku"),
                    quantity=int(item.get("quantity", 0)),
                    processing_status=ProcessingStatus.PENDING
                )
                db.add(line_record)
            
            staged_ids.append(hdr_record.id)
            
        # Log Activity unconditionally
        from app.models import ActivityLog, ActivityType
        log = ActivityLog(
            run_id=state.get("run_id"),
            agent_name="Ingestion",
            title=f"Pipeline Run Started ({date_from or 'All Time'})",
            description=f"Fetched {len(raw_orders)} orders from Shopify: {', '.join([str(o.get('id')) for o in raw_orders])}",
            type=ActivityType.INFO
        )
        db.add(log)
            
        await db.commit()

    return {"staged_order_ids": staged_ids, "raw_orders": raw_orders}
