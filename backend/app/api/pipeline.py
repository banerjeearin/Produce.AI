from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.agents.orchestrator import (
    run_pipeline, resume_pipeline, get_pipeline_state, 
    auto_run_pipeline, auto_run_all_active_runs
)
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

        # Fetch live stock report from ERPNext with 60s memory cache to prevent duplicate Frappe calls
        global _STOCK_REPORT_CACHE
        now_ts = datetime.now().timestamp()
        if "_STOCK_REPORT_CACHE" not in globals() or (now_ts - _STOCK_REPORT_CACHE.get("ts", 0) > 60):
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
                        stock_dict[code] = stock_dict.get(code, 0.0) + qty
                _STOCK_REPORT_CACHE = {"ts": now_ts, "data": stock_dict}
            finally:
                await erp_client.close()
        
        cached_stock_dict = _STOCK_REPORT_CACHE.get("data", {})
        for s in skus_to_check:
            erp_code = erp_item_map.get(s, s)
            stock_qty = cached_stock_dict.get(str(erp_code).strip(), 0.0)
            stock_info[s] = max(0.0, stock_qty)
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

@router.get("/bom-summary")
async def get_bom_summary(date_from: Optional[str] = None, date_to: Optional[str] = None):
    """
    Summarizes all Finished Goods items and BOM creation requirements for the selected date period.
    """
    from app.services.shopify_client import fetch_shopify_orders
    from app.services.erpnext_client import ERPNextClient
    from app.db.session import AsyncSessionLocal
    from app.models import MapShopifySkuErpItem, BomRecipeMaster
    from sqlalchemy.future import select

    parsed_from = parse_date(date_from, end_of_day=False)
    parsed_to = parse_date(date_to, end_of_day=True)

    orders = await fetch_shopify_orders(parsed_from, parsed_to)
    if not orders:
        return {"summary": [], "total_items": 0, "active_boms": 0, "missing_boms": 0}

    erp_client = ERPNextClient()
    try:
        # 1. Fetch ERPNext items map including default_bom directly from Item Master
        resp_items = await erp_client.client.get('/api/resource/Item?fields=["name","item_code","item_name","stock_uom","default_bom"]&limit_page_length=500')
        erp_items = {}
        item_master_boms = {}
        if resp_items.status_code == 200:
            for it in resp_items.json().get("data", []):
                erp_items[it["name"]] = it.get("item_name")
                if it.get("default_bom"):
                    item_master_boms[it["name"]] = it["default_bom"]

        # 2. Fetch active ERPNext BOMs map (from BOM doctype)
        resp_boms = await erp_client.client.get('/api/resource/BOM?fields=["name","item","is_active","is_default"]&limit_page_length=500')
        existing_boms = {}
        if resp_boms.status_code == 200:
            for b in resp_boms.json().get("data", []):
                if b.get("is_active"):
                    existing_boms[b.get("item")] = b.get("name")
        
        # Merge BOMs: prioritize active default BOM, fallback to Item Master default_bom
        for item_key, d_bom in item_master_boms.items():
            if item_key not in existing_boms:
                existing_boms[item_key] = d_bom
    finally:
        await erp_client.close()

    # 3. Fetch local mapping and recipe records
    async with AsyncSessionLocal() as db:
        res_map = await db.execute(select(MapShopifySkuErpItem))
        mappings = {m.shopify_sku: m.erp_item_code for m in res_map.scalars().all()}

        res_recipes = await db.execute(select(BomRecipeMaster))
        recipes = res_recipes.scalars().all()
        recipe_fgs = set(r.fg_item_code for r in recipes)
        import re
        norm_recipe_fgs = set(
            tuple(t.lower() for t in re.split(r'[\s_\-]+', re.sub(r'[\'\"’]', '', r.fg_item_code)) if t)
            for r in recipes
        )

    # 4. Helper to resolve ERP item with fuzzy/size matcher if not in mappings
    erp_matcher_client = ERPNextClient()
    cached_sku_resolutions = {}

    try:
        # 5. Aggregate by Material Code & Shopify SKU
        summary_map = {}
        for o in orders:
            for it in o.get("line_items", []):
                sku = it.get("sku") or it.get("name")
                title = it.get("title") or it.get("name") or sku
                qty = int(it.get("quantity", 1))
                
                # Resolve ERP Material Code:
                # Check local mapping first
                mapped_erp_code = mappings.get(sku)
                if not mapped_erp_code:
                    if sku in erp_items:
                        mapped_erp_code = sku
                    elif sku in cached_sku_resolutions:
                        mapped_erp_code = cached_sku_resolutions[sku]
                    else:
                        matched_item = await erp_matcher_client.get_item(sku, title=title)
                        if matched_item and matched_item.get("name"):
                            mapped_erp_code = matched_item.get("name")
                            # Auto-cache into MapShopifySkuErpItem so it persists
                            async with AsyncSessionLocal() as db_inner:
                                new_m = MapShopifySkuErpItem(shopify_sku=sku, erp_item_code=mapped_erp_code)
                                db_inner.add(new_m)
                                await db_inner.commit()
                            mappings[sku] = mapped_erp_code
                        else:
                            mapped_erp_code = None
                        cached_sku_resolutions[sku] = mapped_erp_code

                erp_code_display = mapped_erp_code or None
                item_name = (erp_items.get(mapped_erp_code) if mapped_erp_code else None) or title
                bom_id = existing_boms.get(mapped_erp_code) if mapped_erp_code else None
                
                # Check recipe presence (direct or normalized tokens)
                has_recipe = (mapped_erp_code in recipe_fgs) or (sku in recipe_fgs)
                if not has_recipe and sku:
                    norm_sku_tokens = tuple(t.lower() for t in re.split(r'[\s_\-]+', re.sub(r'[\'\"’]', '', sku)) if t)
                    has_recipe = norm_sku_tokens in norm_recipe_fgs

                # Grouping key: preferably mapped ERP code, otherwise raw SKU
                group_key = mapped_erp_code or sku

                if group_key not in summary_map:
                    summary_map[group_key] = {
                        "erp_material_code": erp_code_display,
                        "shopify_sku": sku,
                        "item_name": item_name,
                        "total_ordered_qty": 0,
                        "orders_count": 0,
                        "existing_bom": bom_id,
                        "has_recipe": has_recipe,
                        "bom_status": "ACTIVE" if bom_id else ("RECIPE_READY" if has_recipe else "NEEDS_RECIPE")
                    }
                summary_map[group_key]["total_ordered_qty"] += qty
                summary_map[group_key]["orders_count"] += 1
    finally:
        await erp_matcher_client.close()

    summary_list = sorted(list(summary_map.values()), key=lambda x: x["total_ordered_qty"], reverse=True)
    active_count = sum(1 for s in summary_list if s["bom_status"] == "ACTIVE")
    missing_count = sum(1 for s in summary_list if s["bom_status"] != "ACTIVE")

    return {
        "summary": summary_list,
        "total_items": len(summary_list),
        "active_boms": active_count,
        "missing_boms": missing_count
    }

class BomItemToCreate(BaseModel):
    erp_item_code: str
    shopify_sku: Optional[str] = None
    quantity: Optional[float] = 1.0

class CreateBomsRequest(BaseModel):
    items: List[BomItemToCreate]

@router.post("/boms/create-selected")
async def create_selected_boms(req: CreateBomsRequest):
    """
    Creates default BOMs in ERPNext for the selected finished goods using BomRecipeMaster recipes.
    """
    from app.services.erpnext_client import ERPNextClient
    from app.db.session import AsyncSessionLocal
    from app.models import BomRecipeMaster
    from sqlalchemy.future import select
    import re

    if not req.items:
        return {"created": [], "skipped": [], "failed": [], "message": "No items provided."}

    created = []
    skipped = []
    failed = []

    erp_client = ERPNextClient()
    try:
        async with AsyncSessionLocal() as db:
            # Preload all recipe lines into memory for fast matching
            res_all = await db.execute(select(BomRecipeMaster))
            all_recipes = res_all.scalars().all()

            for item in req.items:
                erp_code = (item.erp_item_code or "").strip()
                sku = (item.shopify_sku or "").strip()

                if not erp_code:
                    failed.append({"item": sku or "Unknown", "reason": "Missing ERP Material Code."})
                    continue

                # 1. Check if BOM already exists in ERPNext
                try:
                    existing = await erp_client.get_bom(erp_code)
                    if existing:
                        skipped.append({"item": erp_code, "reason": f"BOM already exists: {existing.get('name')}"})
                        continue
                except Exception as e:
                    # Proceed to creation attempt if check fails
                    pass

                # 2. Find recipe lines for this item
                matching_lines = [
                    r for r in all_recipes 
                    if (r.fg_item_code == erp_code) or (sku and r.fg_item_code == sku)
                ]

                # Fallback: normalized token matching (e.g. ignoring smart quotes / hyphens / underscores)
                if not matching_lines and sku:
                    norm_sku = re.sub(r'[\'\"’]', '', sku).strip()
                    norm_tokens = [t.lower() for t in re.split(r'[\s_\-]+', norm_sku) if t]
                    matching_lines = [
                        r for r in all_recipes
                        if [t.lower() for t in re.split(r'[\s_\-]+', re.sub(r'[\'\"’]', '', r.fg_item_code)) if t] == norm_tokens
                    ]

                if not matching_lines:
                    failed.append({
                        "item": erp_code,
                        "sku": sku,
                        "reason": f"No recipe found in Recipe Master for SKU '{sku}' or Code '{erp_code}'."
                    })
                    continue

                # Output quantity based on total demand quantity
                output_qty = float(item.quantity) if (item.quantity and item.quantity > 0) else 1.0

                # 3. Construct ERPNext BOM items payload
                items_payload = []
                missing_rm = False
                for r in matching_lines:
                    # In ERPNext, raw material qty in BOM is the total required to produce the specified BOM output quantity (Quantity):
                    # required_qty = per_piece_rate * output_qty
                    total_rm_qty = round(r.qty * output_qty, 3)
                    items_payload.append({
                        "item_code": r.raw_material_code,
                        "qty": total_rm_qty,
                        "uom": r.uom or "Meter"
                    })

                if not items_payload:
                    failed.append({"item": erp_code, "reason": "Recipe has 0 raw material lines."})
                    continue

                payload = {
                    "item": erp_code,
                    "quantity": output_qty,
                    "is_active": 1,
                    "is_default": 1,
                    "items": items_payload,
                    "description": f"Auto-created from Recipe Master for {sku or erp_code} (Demand Qty: {output_qty})"
                }

                try:
                    new_bom = await erp_client.create_bom(payload)
                    bom_name = new_bom.get("name") if new_bom else "Created"
                    created.append({
                        "item": erp_code,
                        "bom_id": bom_name,
                        "sku": sku,
                        "raw_materials_count": len(items_payload)
                    })
                except Exception as err:
                    failed.append({
                        "item": erp_code,
                        "sku": sku,
                        "reason": f"ERPNext error: {str(err)}"
                    })
    finally:
        await erp_client.close()

    return {
        "created": created,
        "skipped": skipped,
        "failed": failed,
        "message": f"Successfully created {len(created)} BOMs in ERPNext. ({len(skipped)} already existed, {len(failed)} failed)"
    }

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
    Resumes a paused pipeline thread synchronously for a single stage.
    """
    await resume_pipeline(run_id)
    return {"message": f"Resumed pipeline for run {run_id}"}

@router.post("/runs/{run_id}/auto-run")
async def auto_run_single_pipeline(run_id: str):
    """
    Automatically runs all remaining pipeline stages for a single run until completion.
    """
    await auto_run_pipeline(run_id)
    return {"message": f"Auto-processed all stages for run {run_id}"}

class MassRunRequest(BaseModel):
    run_ids: List[str]

@router.post("/runs/mass-auto-run")
async def mass_auto_run_pipelines(req: MassRunRequest, background_tasks: BackgroundTasks):
    """
    Mass-executes all remaining stages across all provided run IDs in background or concurrently.
    """
    background_tasks.add_task(auto_run_all_active_runs, req.run_ids)
    return {"message": f"Started mass automatic processing for {len(req.run_ids)} run(s).", "run_ids": req.run_ids}


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

class CreateInvoiceRequest(BaseModel):
    run_id: str
    order_id: Optional[str] = None

@router.post("/create-invoice")
async def create_invoice_endpoint(req: CreateInvoiceRequest):
    """
    Facility to create an ERPNext Sales Invoice for an order in a run once stock is created / available.
    """
    from app.db.session import AsyncSessionLocal
    from app.models import (
        StgShopifySalesOrderHdr, StgShopifySalesOrderLine, StgSalesInvoice, 
        InvoicingStatus, ActivityLog, ActivityType, MapShopifySkuErpItem
    )
    from app.services.erpnext_client import ERPNextClient
    from sqlalchemy.future import select
    from sqlalchemy.orm import joinedload
    import os

    company = os.getenv("ERPNEXT_COMPANY", "Aaishka Industries Pvt. Ltd.")
    erp_client = ERPNextClient()

    try:
        async with AsyncSessionLocal() as db:
            # 1. Fetch header
            stmt = (
                select(StgShopifySalesOrderHdr)
                .options(joinedload(StgShopifySalesOrderHdr.lines))
                .where(StgShopifySalesOrderHdr.run_id == req.run_id)
            )
            if req.order_id:
                stmt = stmt.where(
                    (StgShopifySalesOrderHdr.shopify_order_id == req.order_id) | 
                    (StgShopifySalesOrderHdr.order_number == req.order_id)
                )
            
            res = await db.execute(stmt)
            headers = res.unique().scalars().all()
            if not headers:
                raise HTTPException(status_code=404, detail="Order not found for this pipeline run.")

            created_invoices = []

            for hdr in headers:
                # Check if already invoiced in local DB
                stmt_inv = select(StgSalesInvoice).where(StgSalesInvoice.hdr_id == hdr.id)
                res_inv = await db.execute(stmt_inv)
                existing_inv = res_inv.scalars().first()
                if existing_inv and existing_inv.erp_invoice_id:
                    created_invoices.append({
                        "order_id": hdr.order_number or hdr.shopify_order_id,
                        "invoice_id": existing_inv.erp_invoice_id,
                        "status": "ALREADY_EXISTS"
                    })
                    continue

                # Query SKU mappings
                skus = [l.sku for l in hdr.lines if l.sku]
                stmt_m = select(MapShopifySkuErpItem).where(MapShopifySkuErpItem.shopify_sku.in_(skus))
                res_m = await db.execute(stmt_m)
                mappings = {m.shopify_sku: m.erp_item_code for m in res_m.scalars().all()}
                for s in skus:
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

                items = []
                max_tax_rate = 0.0
                for line in hdr.lines:
                    item_code = mappings.get(line.sku, line.sku)
                    qty_to_invoice = line.quantity if line.quantity > 0 else 1
                    
                    tax_rate_dec = (line.gst_rate or 0.0)
                    if tax_rate_dec > 0:
                        max_tax_rate = max(max_tax_rate, tax_rate_dec * 100.0)

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
                        "qty": qty_to_invoice,
                        "price_list_rate": base_price_list_rate,
                        "rate": base_rate,
                        "warehouse": "Finished Goods - AIPL"
                    }
                    if base_discount_amount > 0:
                        item_dict["discount_amount"] = base_discount_amount
                    
                    items.append(item_dict)
                    line.fulfilled_qty = qty_to_invoice
                    line.unfulfilled_qty = 0
                    line.invoicing_status = InvoicingStatus.INVOICED

                if not items:
                    continue

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

                posting_date_str = hdr.created_at.strftime("%Y-%m-%d") if hdr.created_at else datetime.now().strftime("%Y-%m-%d")
                posting_time_str = hdr.created_at.strftime("%H:%M:%S") if hdr.created_at else datetime.now().strftime("%H:%M:%S")

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

                resp_inv = await erp_client.client.post("/api/resource/Sales Invoice", json=payload)
                if resp_inv.status_code not in (200, 201):
                    err_msg = resp_inv.text
                    try:
                        err_msg = resp_inv.json().get("exception", resp_inv.text)
                    except Exception:
                        pass
                    raise HTTPException(status_code=400, detail=f"ERPNext Sales Invoice Error: {err_msg}")

                inv_data = resp_inv.json().get("data", {})
                new_inv_name = inv_data.get("name")

                stg_invoice = StgSalesInvoice(
                    run_id=req.run_id,
                    hdr_id=hdr.id,
                    erp_invoice_id=new_inv_name,
                    status=InvoicingStatus.INVOICED
                )
                db.add(stg_invoice)

                log = ActivityLog(
                    run_id=req.run_id,
                    agent_name="Invoicing",
                    title="Sales Invoice Created",
                    description=f"Directly created Sales Invoice {new_inv_name} for order {hdr.order_number or hdr.shopify_order_id}.",
                    doc_reference=new_inv_name,
                    type=ActivityType.SUCCESS
                )
                db.add(log)

                created_invoices.append({
                    "order_id": hdr.order_number or hdr.shopify_order_id,
                    "invoice_id": new_inv_name,
                    "status": "CREATED"
                })

            await db.commit()

            return {
                "success": True,
                "invoices": created_invoices,
                "message": f"Successfully created {len(created_invoices)} Sales Invoice(s) in ERPNext."
            }
    finally:
        await erp_client.close()

