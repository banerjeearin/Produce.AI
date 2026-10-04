from fastapi import APIRouter, HTTPException
from typing import List
from app.services.material_master_service import (
    MaterialMasterCreateRequest,
    MaterialMasterPreviewRequest,
    create_material_master,
    check_material_master_status
)
from app.services.erpnext_client import ERPNextClient

router = APIRouter()

@router.get("/status/{identifier}")
async def get_item_status(identifier: str):
    """
    Checks the status and mapping of a Material Master without triggering any modification or pipeline run.
    """
    try:
        return await check_material_master_status(identifier)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/preview")
async def preview_material_masters(req: MaterialMasterPreviewRequest):
    """
    Batch checks items / SKUs against ERPNext and local mapping (read-only, does not create anything).
    """
    results = []
    for item in req.skus_or_items:
        res = await check_material_master_status(item)
        results.append(res)
    return {"results": results}

@router.post("/create")
async def create_single_material_master(req: MaterialMasterCreateRequest):
    """
    Explicitly creates a Material Master item in ERPNext when invoked directly by user.
    Completely isolated from the manufacturing pipeline.
    """
    try:
        return await create_material_master(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create Material Master: {str(e)}")

@router.post("/sync/dry-run")
async def sync_material_masters_dry_run(only: str = None):
    """
    Simulates Shopify -> ERPNext template and variant creation (Dry run, no writes).
    """
    try:
        from starlette.concurrency import run_in_threadpool
        from sync_shopify_to_erpnext import run_sync
        res = await run_in_threadpool(run_sync, apply=False, only=only or None)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync/apply")
async def sync_material_masters_apply(only: str = None, backfill: bool = False):
    """
    Executes Shopify -> ERPNext template and variant creation.
    """
    try:
        from starlette.concurrency import run_in_threadpool
        from sync_shopify_to_erpnext import run_sync
        res = await run_in_threadpool(run_sync, apply=True, only=only or None, backfill=backfill)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
