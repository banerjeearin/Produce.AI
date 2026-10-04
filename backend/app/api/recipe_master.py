from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import date
import time
from sqlalchemy.future import select
from sqlalchemy import or_, desc, delete
from app.db.session import AsyncSessionLocal
from app.models import BomRecipeMaster
from app.services.erpnext_client import ERPNextClient

router = APIRouter()

# In-memory cache for raw materials with stock to prevent hammering ERPNext on every page load
_RM_CACHE = {
    "timestamp": 0,
    "items_map": {},      # code -> {item_code, item_name, stock_uom, bal_qty}
    "raw_materials": []   # list of enriched raw materials
}
CACHE_TTL = 120  # 2 minutes

class RecipeCreateRequest(BaseModel):
    fg_item_code: str = Field(..., description="Finished good item code or Shopify SKU")
    raw_material_code: str = Field(..., description="Raw material item code in ERPNext")
    qty: float = Field(..., gt=0, description="Quantity required per unit of finished good")
    uom: str = Field(default="Meter", description="Unit of measurement")

class RecipeUpdateRequest(BaseModel):
    raw_material_code: Optional[str] = None
    qty: Optional[float] = None
    uom: Optional[str] = None

class BatchRecipeLine(BaseModel):
    raw_material_code: str
    qty: float
    uom: str = "Meter"

class BatchRecipeCreateRequest(BaseModel):
    fg_item_code: str
    lines: List[BatchRecipeLine]

async def _get_enriched_raw_materials_cached():
    global _RM_CACHE
    now = time.time()
    if now - _RM_CACHE["timestamp"] < CACHE_TTL and _RM_CACHE["raw_materials"]:
        return _RM_CACHE["items_map"], _RM_CACHE["raw_materials"]

    client = ERPNextClient()
    try:
        rms = await client.get_raw_materials()
        stock_report = await client.get_stock_balance_report(date.today().isoformat())
        
        # Build stock balance dictionary
        stock_map = {}
        for s in stock_report:
            if isinstance(s, dict):
                code = s.get("item_code")
                stock_map[code] = stock_map.get(code, 0.0) + float(s.get("bal_qty", 0.0))

        items_map = {}
        enriched_rms = []
        for rm in rms:
            code = rm.get("item_code")
            name = rm.get("item_name") or code
            uom = rm.get("stock_uom") or "Meter"
            bal_qty = round(stock_map.get(code, 0.0), 2)

            info = {
                "item_code": code,
                "item_name": name,
                "stock_uom": uom,
                "bal_qty": bal_qty,
                "has_stock": bal_qty > 0
            }
            items_map[code] = info
            enriched_rms.append(info)

        # Sort: items with stock first (highest quantity first), then alphabetical
        enriched_rms.sort(key=lambda x: (-x["bal_qty"], x["item_name"]))

        _RM_CACHE["timestamp"] = now
        _RM_CACHE["items_map"] = items_map
        _RM_CACHE["raw_materials"] = enriched_rms
        return items_map, enriched_rms
    finally:
        await client.close()

@router.get("/list")
async def list_recipes(
    search: Optional[str] = Query(None, description="Search by FG or RM item code"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200)
):
    """
    Paginated display of BOM recipes in the Recipe Master enriched with ERPNext Material Name & Available Stock.
    """
    # Fetch RM metadata (name and stock balance)
    try:
        items_map, _ = await _get_enriched_raw_materials_cached()
    except Exception:
        items_map = {}

    async with AsyncSessionLocal() as db:
        stmt = select(BomRecipeMaster)
        if search and search.strip():
            term = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    BomRecipeMaster.fg_item_code.ilike(term),
                    BomRecipeMaster.raw_material_code.ilike(term)
                )
            )
        
        # Count total
        count_stmt = select(BomRecipeMaster)
        if search and search.strip():
            term = f"%{search.strip()}%"
            count_stmt = count_stmt.where(
                or_(
                    BomRecipeMaster.fg_item_code.ilike(term),
                    BomRecipeMaster.raw_material_code.ilike(term)
                )
            )
        all_res = await db.execute(count_stmt)
        total_count = len(all_res.scalars().all())

        # Pagination
        offset = (page - 1) * limit
        stmt = stmt.order_by(desc(BomRecipeMaster.id)).offset(offset).limit(limit)
        res = await db.execute(stmt)
        recipes = res.scalars().all()

        enriched_items = []
        for r in recipes:
            rm_info = items_map.get(r.raw_material_code, {})
            enriched_items.append({
                "id": r.id,
                "fg_item_code": r.fg_item_code,
                "raw_material_code": r.raw_material_code,
                "raw_material_name": rm_info.get("item_name") or r.raw_material_code,
                "available_stock": rm_info.get("bal_qty", 0.0),
                "qty": r.qty,
                "uom": r.uom or rm_info.get("stock_uom", "Meter")
            })

        return {
            "total": total_count,
            "page": page,
            "limit": limit,
            "items": enriched_items
        }

@router.get("/fg/{fg_item_code}")
async def get_recipe_by_fg(fg_item_code: str):
    """
    Display all recipe lines for a specific finished good with Material Name & Available Stock.
    """
    try:
        items_map, _ = await _get_enriched_raw_materials_cached()
    except Exception:
        items_map = {}

    async with AsyncSessionLocal() as db:
        stmt = select(BomRecipeMaster).where(BomRecipeMaster.fg_item_code == fg_item_code)
        res = await db.execute(stmt)
        lines = res.scalars().all()
        return {
            "fg_item_code": fg_item_code,
            "exists": len(lines) > 0,
            "lines": [
                {
                    "id": l.id,
                    "raw_material_code": l.raw_material_code,
                    "raw_material_name": items_map.get(l.raw_material_code, {}).get("item_name") or l.raw_material_code,
                    "available_stock": items_map.get(l.raw_material_code, {}).get("bal_qty", 0.0),
                    "qty": l.qty,
                    "uom": l.uom or items_map.get(l.raw_material_code, {}).get("stock_uom", "Meter")
                }
                for l in lines
            ]
        }

@router.post("/create")
async def create_recipe(req: RecipeCreateRequest):
    """
    Create a new Recipe line in Recipe Master.
    """
    fg_code = req.fg_item_code.strip()
    rm_code = req.raw_material_code.strip()
    uom = req.uom.strip() or "Meter"

    async with AsyncSessionLocal() as db:
        stmt = select(BomRecipeMaster).where(
            BomRecipeMaster.fg_item_code == fg_code,
            BomRecipeMaster.raw_material_code == rm_code
        )
        existing = (await db.execute(stmt)).scalars().first()
        if existing:
            raise HTTPException(
                status_code=400, 
                detail=f"Recipe already exists for FG '{fg_code}' with Raw Material '{rm_code}' (ID: {existing.id}). Use Change/Update instead."
            )

        new_recipe = BomRecipeMaster(
            fg_item_code=fg_code,
            raw_material_code=rm_code,
            qty=req.qty,
            uom=uom
        )
        db.add(new_recipe)
        await db.commit()
        await db.refresh(new_recipe)

        return {
            "message": f"Recipe created successfully for '{fg_code}'",
            "recipe": {
                "id": new_recipe.id,
                "fg_item_code": new_recipe.fg_item_code,
                "raw_material_code": new_recipe.raw_material_code,
                "qty": new_recipe.qty,
                "uom": new_recipe.uom
            }
        }

@router.put("/update/{recipe_id}")
async def update_recipe(recipe_id: int, req: RecipeUpdateRequest):
    """
    Change/Update an existing Recipe line by ID.
    """
    async with AsyncSessionLocal() as db:
        stmt = select(BomRecipeMaster).where(BomRecipeMaster.id == recipe_id)
        recipe = (await db.execute(stmt)).scalars().first()
        if not recipe:
            raise HTTPException(status_code=404, detail=f"Recipe with ID {recipe_id} not found.")

        if req.raw_material_code is not None:
            recipe.raw_material_code = req.raw_material_code.strip()
        if req.qty is not None:
            if req.qty <= 0:
                raise HTTPException(status_code=400, detail="Quantity must be greater than zero.")
            recipe.qty = req.qty
        if req.uom is not None:
            recipe.uom = req.uom.strip()

        await db.commit()
        await db.refresh(recipe)

        return {
            "message": f"Recipe #{recipe.id} updated successfully",
            "recipe": {
                "id": recipe.id,
                "fg_item_code": recipe.fg_item_code,
                "raw_material_code": recipe.raw_material_code,
                "qty": recipe.qty,
                "uom": recipe.uom
            }
        }

@router.delete("/delete/{recipe_id}")
async def delete_recipe(recipe_id: int):
    """
    Remove a recipe line from Recipe Master.
    """
    async with AsyncSessionLocal() as db:
        stmt = select(BomRecipeMaster).where(BomRecipeMaster.id == recipe_id)
        recipe = (await db.execute(stmt)).scalars().first()
        if not recipe:
            raise HTTPException(status_code=404, detail=f"Recipe with ID {recipe_id} not found.")

        await db.delete(recipe)
        await db.commit()
        return {"message": f"Recipe #{recipe_id} deleted successfully."}

@router.get("/raw-materials")
async def get_available_raw_materials(only_in_stock: bool = Query(False)):
    """
    Fetches raw materials from ERPNext with current inventory balance and stock availability.
    """
    try:
        _, raw_materials = await _get_enriched_raw_materials_cached()
        if only_in_stock:
            filtered = [rm for rm in raw_materials if rm.get("bal_qty", 0) > 0]
            return {"raw_materials": filtered, "total": len(filtered)}
        return {"raw_materials": raw_materials, "total": len(raw_materials)}
    except Exception as e:
        return {"raw_materials": [], "total": 0, "warning": str(e)}
