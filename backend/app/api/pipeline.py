from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from app.agents.orchestrator import run_pipeline, resume_pipeline, get_pipeline_state
from app.services.shopify_client import fetch_shopify_orders
import os
import uuid
import pytz

router = APIRouter()

class PipelineRequest(BaseModel):
    date_from: Optional[str] = None # Expects DD.MM.YYYY
    date_to: Optional[str] = None # Expects DD.MM.YYYY

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
        print(f"Date parsing error for '{date_str}': {e}")
        return None

@router.post("/run")
async def trigger_pipeline(req: PipelineRequest, background_tasks: BackgroundTasks):
    parsed_from = parse_date(req.date_from, end_of_day=False)
    parsed_to = parse_date(req.date_to, end_of_day=True)
    print(f"--- TRIGGER PIPELINE: from={parsed_from} to={parsed_to} ---")
    
    # 1. Fetch all orders matching criteria from Shopify
    orders = await fetch_shopify_orders(parsed_from, parsed_to)
    
    if not orders:
        return {"message": "No Shopify orders found in the selected date range."}
        
    # 2. Query ERPNext & local DB for already invoiced orders to deduplicate
    existing_invoiced_orders = set()
    from app.services.erpnext_client import ERPNextClient
    erp_client = ERPNextClient()
    try:
        # Fetch existing Sales Invoices from ERPNext that have a po_no (Shopify Order ID or Order Number)
        resp = await erp_client.client.get('/api/resource/Sales Invoice?fields=["name","po_no","docstatus"]&limit_page_length=1000')
        if resp.status_code == 200:
            for inv in resp.json().get("data", []):
                po = inv.get("po_no")
                # Exclude cancelled invoices (docstatus == 2)
                if po and inv.get("docstatus") != 2:
                    clean_po = str(po).strip()
                    existing_invoiced_orders.add(clean_po)
                    # Also normalize leading #
                    if clean_po.startswith("#"):
                        existing_invoiced_orders.add(clean_po.lstrip("#"))
                    else:
                        existing_invoiced_orders.add(f"#{clean_po}")
    except Exception as e:
        print(f"Warning checking ERPNext existing invoices: {e}")
    finally:
        await erp_client.close()

    # Also check local DB for completed sales invoices
    try:
        from app.db.session import AsyncSessionLocal
        from app.models import StgShopifySalesOrderHdr, StgSalesInvoice, InvoicingStatus
        from sqlalchemy.future import select
        async with AsyncSessionLocal() as db:
            stmt_inv = (
                select(StgShopifySalesOrderHdr.shopify_order_id, StgShopifySalesOrderHdr.order_number)
                .join(StgSalesInvoice, StgSalesInvoice.hdr_id == StgShopifySalesOrderHdr.id)
                .where(StgSalesInvoice.status == InvoicingStatus.INVOICED)
            )
            res_inv = await db.execute(stmt_inv)
            for r in res_inv.all():
                if r[0]:
                    existing_invoiced_orders.add(str(r[0]).strip())
                if r[1]:
                    existing_invoiced_orders.add(str(r[1]).strip())
                    existing_invoiced_orders.add(f"#{r[1]}")
    except Exception as e:
        print(f"Warning checking local DB invoices: {e}")

    # Filter out orders that already have sales invoices created
    orders_to_process = []
    skipped_orders = []

    for order in orders:
        order_id_str = str(order.get("id") or "").strip()
        order_num_str = str(order.get("order_number") or "").strip()
        order_name_str = str(order.get("name") or "").strip()

        is_duplicate = (
            order_id_str in existing_invoiced_orders or
            order_num_str in existing_invoiced_orders or
            order_name_str in existing_invoiced_orders
        )

        if is_duplicate:
            skipped_orders.append(order_name_str or f"#{order_num_str}" or order_id_str)
        else:
            orders_to_process.append(order)

    # 3. Spawn a separate pipeline run for new un-invoiced orders
    run_ids = []
    for order in orders_to_process:
        run_id = str(uuid.uuid4())
        run_ids.append(run_id)
        background_tasks.add_task(run_pipeline, run_id=run_id, raw_orders=[order], date_from=parsed_from, date_to=parsed_to)
        
    if not orders_to_process:
        skipped_names = ", ".join(skipped_orders[:8]) + ("..." if len(skipped_orders) > 8 else "")
        return {
            "message": f"All {len(orders)} order(s) ({skipped_names}) in this range already have Sales Invoices in ERPNext. No new runs required.",
            "run_ids": [],
            "skipped_count": len(skipped_orders),
            "processed_count": 0
        }

    msg = f"Triggered {len(orders_to_process)} pipeline run(s)."
    if skipped_orders:
        skipped_names = ", ".join(skipped_orders[:5]) + ("..." if len(skipped_orders) > 5 else "")
        msg += f" (Deduplication: Skipped {len(skipped_orders)} already invoiced order(s): {skipped_names})"

    return {
        "message": msg,
        "run_ids": run_ids,
        "skipped_count": len(skipped_orders),
        "processed_count": len(orders_to_process)
    }

@router.get("/runs/{run_id}/state")
async def get_run_state(run_id: str):
    """
    Returns the current LangGraph state for a given run_id with live ERPNext inventory.
    """
    snapshot = await get_pipeline_state(run_id)
    if not snapshot:
        return {"status": "NOT_FOUND"}
    
    values = snapshot.values or {}
    
    # Enrich state with mapped ERP Item Codes and cached stock inventory
    stock_info = {}
    erp_item_map = {}
    from app.db.session import AsyncSessionLocal
    from app.models import MapShopifySkuErpItem
    from sqlalchemy.future import select
    
    try:
        raw_orders = values.get("raw_orders", [])
        skus_to_check = set()
        for order in raw_orders:
            for item in order.get("line_items", []):
                sku = item.get("sku") or item.get("name")
                if sku:
                    skus_to_check.add(sku)
        
        async with AsyncSessionLocal() as db:
            if skus_to_check:
                stmt = select(MapShopifySkuErpItem).where(MapShopifySkuErpItem.shopify_sku.in_(list(skus_to_check)))
                res = await db.execute(stmt)
                mappings = res.scalars().all()
                for m in mappings:
                    erp_item_map[m.shopify_sku] = m.erp_item_code
                
                # Fill defaults
                for s in skus_to_check:
                    if s not in erp_item_map:
                        erp_item_map[s] = s

        # Fetch live stock report from ERPNext (strictly using ERPNext Item ID)
        from app.services.erpnext_client import ERPNextClient
        erp_client = ERPNextClient()
        try:
            today_str = datetime.now().strftime("%Y-%m-%d")
            stock_report = await erp_client.get_stock_balance_report(today_str)
            stock_dict = {}
            for r in stock_report:
                if isinstance(r, dict) and r.get("item_code"):
                    code = str(r.get("item_code")).strip()
                    qty = float(r.get("bal_qty", 0.0))
                    stock_dict[code] = qty
            
            for s in skus_to_check:
                erp_code = erp_item_map.get(s, s)
                stock_qty = stock_dict.get(str(erp_code).strip(), 0.0)
                stock_info[s] = max(0.0, stock_qty)
        finally:
            await erp_client.close()
    except Exception as e:
        print(f"Error enriching state with live stock: {e}")
        for s in skus_to_check:
            stock_info[s] = 0.0
        
    # Fetch any created Sales Invoices for this run
    sales_invoices = []
    try:
        from app.models import StgSalesInvoice
        async with AsyncSessionLocal() as db:
            stmt_inv = select(StgSalesInvoice).where(StgSalesInvoice.run_id == run_id)
            res_inv = await db.execute(stmt_inv)
            invoices = res_inv.scalars().all()
            for inv in invoices:
                sales_invoices.append({
                    "id": inv.id,
                    "erp_invoice_id": inv.erp_invoice_id,
                    "status": inv.status.value if hasattr(inv.status, "value") else str(inv.status),
                    "created_at": inv.created_at.isoformat() if inv.created_at else None
                })
    except Exception as e:
        print(f"Error fetching invoices for run {run_id}: {e}")

    values["stock_balances"] = stock_info
    values["erp_item_map"] = erp_item_map
    values["sales_invoices"] = sales_invoices
    
    return {
        "status": "PAUSED" if len(snapshot.next) > 0 else "COMPLETED",
        "next_nodes": list(snapshot.next),
        "values": values
    }

class MappingUpdateRequest(BaseModel):
    shopify_sku: str
    erp_item_code: str
    run_id: Optional[str] = None

@router.get("/erp-items")
async def get_erp_items():
    """
    Fetches available ERPNext Finished Goods items for classification dropdown/search.
    """
    from app.services.erpnext_client import ERPNextClient
    erp_client = ERPNextClient()
    try:
        resp = await erp_client.client.get('/api/resource/Item?fields=["name","item_code","item_name","stock_uom"]&limit_page_length=500')
        if resp.status_code == 200:
            items = resp.json().get("data", [])
            # Filter out raw materials or include all relevant products
            return {"items": items}
        return {"items": []}
    except Exception as e:
        print(f"Error fetching ERPNext items: {e}")
        return {"items": []}
    finally:
        await erp_client.close()

@router.post("/mapping/update")
async def update_sku_mapping(req: MappingUpdateRequest):
    """
    Updates or creates a mapping between a Shopify SKU and an ERPNext Item ID.
    """
    from app.db.session import AsyncSessionLocal
    from app.models import MapShopifySkuErpItem, ActivityLog, ActivityType
    from sqlalchemy.future import select

    clean_sku = req.shopify_sku.strip()
    clean_erp_code = req.erp_item_code.strip()

    async with AsyncSessionLocal() as db:
        stmt = select(MapShopifySkuErpItem).where(MapShopifySkuErpItem.shopify_sku == clean_sku)
        res = await db.execute(stmt)
        existing = res.scalars().first()

        if existing:
            existing.erp_item_code = clean_erp_code
        else:
            new_map = MapShopifySkuErpItem(shopify_sku=clean_sku, erp_item_code=clean_erp_code)
            db.add(new_map)

        if req.run_id:
            log = ActivityLog(
                run_id=req.run_id,
                agent_name="Classification",
                title="Classification Mapping Edited",
                description=f"User updated mapping for SKU '{clean_sku}' -> ERPNext Item ID '{clean_erp_code}'",
                doc_reference=clean_erp_code,
                type=ActivityType.INFO
            )
            db.add(log)

        await db.commit()

    return {
        "success": True,
        "shopify_sku": clean_sku,
        "erp_item_code": clean_erp_code,
        "message": f"Successfully mapped '{clean_sku}' to ERPNext Item ID '{clean_erp_code}'"
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
