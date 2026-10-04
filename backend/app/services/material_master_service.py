"""
Material Master Creation Module (Stand-alone from Pipeline).
Provides independent validation, preview, and creation of ERPNext Items (Raw Materials and Finished Goods)
without touching or executing within the main manufacturing pipeline.
"""
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from app.db.session import AsyncSessionLocal
from app.models import MapShopifySkuErpItem
from app.services.erpnext_client import ERPNextClient
from sqlalchemy.future import select

class MaterialMasterCreateRequest(BaseModel):
    item_code: str
    item_name: str
    item_group: str = "Products" # e.g. "Products", "Raw Material", "Sub Assemblies"
    stock_uom: str = "Nos"        # e.g. "Nos", "Meter", "Kg"
    is_stock_item: int = 1
    is_sales_item: int = 1
    include_item_in_manufacturing: int = 1
    shopify_sku: Optional[str] = None # Optional SKU to map upon creation

class MaterialMasterPreviewRequest(BaseModel):
    skus_or_items: List[str]

async def check_material_master_status(identifier: str) -> Dict[str, Any]:
    """
    Checks if an item exists in local mapping and ERPNext without creating anything.
    """
    clean_id = str(identifier).strip()
    erp_client = ERPNextClient()
    try:
        # Check local DB mapping first
        async with AsyncSessionLocal() as db:
            stmt = select(MapShopifySkuErpItem).where(MapShopifySkuErpItem.shopify_sku == clean_id)
            res = await db.execute(stmt)
            mapping = res.scalars().first()
            local_mapped_code = mapping.erp_item_code if mapping else None

        # Check ERPNext existence
        erp_item = await erp_client.get_item(local_mapped_code or clean_id)
        exists_in_erp = erp_item is not None
        
        return {
            "query": clean_id,
            "exists_in_erp": exists_in_erp,
            "erp_item_code": erp_item.get("name") if erp_item else local_mapped_code,
            "erp_item_name": erp_item.get("item_name") if erp_item else None,
            "item_group": erp_item.get("item_group") if erp_item else None,
            "stock_uom": erp_item.get("stock_uom") if erp_item else None,
            "is_mapped_locally": local_mapped_code is not None
        }
    finally:
        await erp_client.close()

async def create_material_master(req: MaterialMasterCreateRequest) -> Dict[str, Any]:
    """
    Independent Material Master creation function for ERPNext.
    Does NOT run in the automated pipeline.
    """
    erp_client = ERPNextClient()
    try:
        payload = {
            "item_code": req.item_code.strip(),
            "item_name": req.item_name.strip(),
            "item_group": req.item_group,
            "is_stock_item": req.is_stock_item,
            "is_sales_item": req.is_sales_item,
            "include_item_in_manufacturing": req.include_item_in_manufacturing,
            "stock_uom": req.stock_uom
        }
        
        created_item = await erp_client.create_item(payload)
        actual_code = created_item.get("name", req.item_code) if created_item else req.item_code
        
        # If shopify_sku provided or item_code corresponds to a SKU, update local mapping
        target_sku = req.shopify_sku or req.item_code
        if target_sku:
            async with AsyncSessionLocal() as db:
                stmt = select(MapShopifySkuErpItem).where(MapShopifySkuErpItem.shopify_sku == target_sku)
                res = await db.execute(stmt)
                existing = res.scalars().first()
                if existing:
                    existing.erp_item_code = actual_code
                else:
                    new_map = MapShopifySkuErpItem(shopify_sku=target_sku, erp_item_code=actual_code)
                    db.add(new_map)
                await db.commit()
                
        return {
            "status": "SUCCESS",
            "message": f"Material Master '{actual_code}' successfully created in ERPNext.",
            "data": created_item,
            "mapped_sku": target_sku
        }
    finally:
        await erp_client.close()
