from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from app.services.erpnext_client import ERPNextClient
from app.db.session import AsyncSessionLocal
from app.models import BomRecipeMaster, MapShopifySkuErpItem
from sqlalchemy.future import select
import time

router = APIRouter()

# Cache for ERPNext BOM list
_BOM_CACHE = {
    "timestamp": 0,
    "boms": []
}
CACHE_TTL = 30  # 30 seconds

class BomCreateItemLine(BaseModel):
    item_code: str
    qty: float
    uom: str = "Meter"

class BomCreateRequest(BaseModel):
    item_code: str = Field(..., description="Finished good item code in ERPNext")
    quantity: float = Field(default=1.0, gt=0, description="Output manufacturing quantity")
    is_active: int = 1
    is_default: int = 1
    items: Optional[List[BomCreateItemLine]] = None
    use_recipe_master: bool = False
    description: Optional[str] = None

class BomToggleDefaultRequest(BaseModel):
    is_default: int
    is_active: Optional[int] = None

@router.get("/list")
async def list_boms(
    search: Optional[str] = Query(None, description="Search by BOM ID, Item Code, or Item Name"),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100)
):
    """
    Paginated list of all Bill of Materials (BOMs) from ERPNext with FG names, output qty, status, and costs.
    """
    global _BOM_CACHE
    now = time.time()
    
    client = ERPNextClient()
    try:
        # Check cache or fetch
        if now - _BOM_CACHE["timestamp"] < CACHE_TTL and _BOM_CACHE["boms"]:
            all_boms = _BOM_CACHE["boms"]
        else:
            fields = '["name","item","item_name","quantity","uom","is_active","is_default","total_cost","currency","modified"]'
            resp = await client.client.get(f'/api/resource/BOM?fields={fields}&limit_page_length=500&order_by=modified%20desc')
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"Failed to fetch BOMs from ERPNext: {resp.text}")
            all_boms = resp.json().get("data", [])
            _BOM_CACHE["timestamp"] = now
            _BOM_CACHE["boms"] = all_boms

        # Filter if search query provided
        if search and search.strip():
            term = search.strip().lower()
            filtered = [
                b for b in all_boms 
                if term in (b.get("name") or "").lower() 
                or term in (b.get("item") or "").lower() 
                or term in (b.get("item_name") or "").lower()
            ]
        else:
            filtered = all_boms

        total = len(filtered)
        offset = (page - 1) * limit
        paginated_items = filtered[offset:offset + limit]

        return {
            "total": total,
            "page": page,
            "limit": limit,
            "items": paginated_items
        }
    finally:
        await client.close()

@router.get("/details/{bom_id}")
async def get_bom_details(bom_id: str):
    """
    Fetches comprehensive details of a single BOM, including all raw materials, operations, and costing.
    """
    client = ERPNextClient()
    try:
        resp = await client.client.get(f"/api/resource/BOM/{bom_id}")
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail=f"BOM '{bom_id}' not found in ERPNext.")
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        
        bom_data = resp.json().get("data", {})
        
        # Check if corresponding recipe exists in BomRecipeMaster
        fg_item = bom_data.get("item")
        recipe_lines = []
        if fg_item:
            async with AsyncSessionLocal() as db:
                stmt = select(BomRecipeMaster).where(
                    (BomRecipeMaster.fg_item_code == fg_item)
                )
                res = await db.execute(stmt)
                recipe_lines = [
                    {
                        "id": r.id,
                        "raw_material_code": r.raw_material_code,
                        "qty": r.qty,
                        "uom": r.uom
                    }
                    for r in res.scalars().all()
                ]

        return {
            "bom": bom_data,
            "recipe_master_lines": recipe_lines
        }
    finally:
        await client.close()

@router.post("/create")
async def create_bom_endpoint(req: BomCreateRequest):
    """
    Creates a new Bill of Materials directly in ERPNext.
    Optionally pulls raw materials automatically from Recipe Master if use_recipe_master=True.
    """
    item_code = req.item_code.strip()
    client = ERPNextClient()
    try:
        # Check if item exists in ERPNext
        item_data = await client.get_item(item_code)
        if not item_data:
            raise HTTPException(status_code=400, detail=f"Item '{item_code}' not found in ERPNext. Create Material Master first.")

        raw_materials_payload = []
        
        if req.use_recipe_master or not req.items:
            # Query local Recipe Master
            async with AsyncSessionLocal() as db:
                stmt = select(BomRecipeMaster).where(
                    (BomRecipeMaster.fg_item_code == item_code)
                )
                res = await db.execute(stmt)
                lines = res.scalars().all()
                if not lines:
                    raise HTTPException(
                        status_code=400, 
                        detail=f"No recipe found in Recipe Master for '{item_code}'. Provide items manually or add to Recipe Master."
                    )
                for l in lines:
                    raw_materials_payload.append({
                        "item_code": l.raw_material_code,
                        "qty": round(l.qty * req.quantity, 3),
                        "uom": l.uom or "Meter"
                    })
        else:
            for it in req.items:
                raw_materials_payload.append({
                    "item_code": it.item_code.strip(),
                    "qty": it.qty,
                    "uom": it.uom
                })

        if not raw_materials_payload:
            raise HTTPException(status_code=400, detail="At least one raw material line is required.")

        payload = {
            "item": item_code,
            "quantity": req.quantity,
            "is_active": req.is_active,
            "is_default": req.is_default,
            "items": raw_materials_payload,
            "description": req.description or f"Created via BOM Master for {item_code} (Qty: {req.quantity})"
        }

        created = await client.create_bom(payload)
        
        # Invalidate cache
        global _BOM_CACHE
        _BOM_CACHE["timestamp"] = 0

        return {
            "message": f"Successfully created BOM '{created.get('name')}' for item '{item_code}'",
            "bom": created
        }
    finally:
        await client.close()

@router.put("/update/{bom_id}/toggle-status")
async def toggle_bom_status(bom_id: str, req: BomToggleDefaultRequest):
    """
    Sets whether a BOM is active or the default BOM for its item.
    """
    client = ERPNextClient()
    try:
        update_data = {"is_default": req.is_default}
        if req.is_active is not None:
            update_data["is_active"] = req.is_active

        resp = await client.client.put(f"/api/resource/BOM/{bom_id}", json=update_data)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        
        bom_data = resp.json().get("data", {})
        item_code = bom_data.get("item")
        
        # If set as default, also update item master
        if req.is_default and item_code:
            await client.client.put(f"/api/resource/Item/{item_code}", json={"default_bom": bom_id})

        # Invalidate cache
        global _BOM_CACHE
        _BOM_CACHE["timestamp"] = 0

        return {
            "message": f"BOM '{bom_id}' status updated successfully",
            "bom": bom_data
        }
    finally:
        await client.close()
