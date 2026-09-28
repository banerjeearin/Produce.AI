import asyncio
from app.db.session import AsyncSessionLocal
from app.models import BomRecipeMaster
from app.services.erpnext_client import ERPNextClient
from sqlalchemy.future import select
from sqlalchemy import delete
import httpx
from dotenv import load_dotenv

load_dotenv()

# Master Recipe Data from Garment Specification Sheet
# Units are meters per piece
RECIPE_MATRIX = [
    {"product": "Ivy Tie-up Skirt", "XS": 1.50, "S": 1.60, "M": 1.70, "L": 1.80, "XL": None},
    {"product": "Midnight Picnic Maxi Skirt", "XS": 1.25, "S": 1.25, "M": 1.60, "L": 1.60, "XL": None},
    {"product": "Midnight Picnic Corset Top (Padded)", "XS": 1.50, "S": 1.60, "M": 1.70, "L": 1.80, "XL": None},
    {"product": "Celeste Halter Top", "XS": 0.90, "S": 0.95, "M": 1.00, "L": 1.10, "XL": None},
    {"product": "Red On The Run Top", "XS": 1.50, "S": 1.50, "M": 1.70, "L": 1.70, "XL": None},
    {"product": "Viola Peplum Top", "XS": 1.50, "S": 1.50, "M": 1.70, "L": 1.70, "XL": None},
    {"product": "Laidback Luxe Shirt", "XS": 1.80, "S": 1.80, "M": 1.90, "L": 2.00, "XL": None},
    {"product": "Laidback Luxe Trouser", "XS": 2.00, "S": 2.00, "M": 2.10, "L": 2.10, "XL": None},
    {"product": "June Tube Top with Scarf", "XS": 2.60, "S": 2.65, "M": 2.70, "L": 2.75, "XL": None},
    {"product": "Sage Structured Top", "XS": 1.50, "S": 1.50, "M": 1.70, "L": 1.70, "XL": None},
    {"product": "Noorie Chikankari Kurti", "XS": 1.50, "S": 1.50, "M": 1.70, "L": 1.70, "XL": None},
    {"product": "Raahi Black Men's Kurta", "XS": 1.50, "S": 2.50, "M": 2.50, "L": 2.75, "XL": 2.75},
    {"product": "The Plum Top", "XS": 1.20, "S": 1.20, "M": 1.30, "L": 1.40, "XL": None},
    {"product": "The Ira Top", "XS": 1.70, "S": 1.75, "M": 1.80, "L": 1.90, "XL": None},
    {"product": "Sitara White Cover-up Kurti", "XS": 2.00, "S": 2.00, "M": 2.25, "L": 2.25, "XL": None},
    {"product": "Idan Maroon Men's Kurta", "XS": 1.50, "S": 2.50, "M": 2.50, "L": 2.75, "XL": 2.75},
    {"product": "Faux 9 to 5 Crop Blazer", "XS": 1.50, "S": 1.50, "M": 1.70, "L": 1.70, "XL": None},
    {"product": "The Axis Jacket", "XS": 2.30, "S": 2.40, "M": 2.50, "L": 2.60, "XL": None},
    {"product": "The Sera Top", "XS": 1.50, "S": 1.50, "M": 1.70, "L": 1.70, "XL": None},
    {"product": "Midnight Ikat Co-ord Set", "XS": 2.60, "S": 2.65, "M": 2.70, "L": 2.90, "XL": None},
    {"product": "Dune Cotton Shirt", "XS": 1.50, "S": 1.80, "M": 1.90, "L": 2.00, "XL": None},
    {"product": "Noir Ikat Short-sleeve Shirt (Unisex)", "XS": 1.50, "S": 1.50, "M": 1.70, "L": 1.70, "XL": None},
    {"product": "Rose One-shoulder Top", "XS": 1.00, "S": 1.00, "M": 1.10, "L": 1.20, "XL": None},
    {"product": "June Bell-bottom Flare Pants", "XS": 1.15, "S": 1.25, "M": 1.25, "L": 1.25, "XL": None},
]

RAW_MATERIAL_CODE = "STO-ITEM-2025-00021"

async def main():
    client = ERPNextClient()
    
    # 1. Ensure Raw Material exists in ERPNext
    try:
        item = await client.get_item(RAW_MATERIAL_CODE)
        if not item:
            print(f"Raw material {RAW_MATERIAL_CODE} not found in ERPNext. Please ensure it is created.")
        else:
            print(f"Found Raw Material {RAW_MATERIAL_CODE} in ERPNext: {item.get('item_name')}")
    except Exception as e:
        print(f"Warning checking ERPNext RM {RAW_MATERIAL_CODE}: {e}")

    # 2. Insert Recipes into bom_recipe_master
    async with AsyncSessionLocal() as db:
        inserted_count = 0
        
        for item_data in RECIPE_MATRIX:
            product_name = item_data["product"]
            for size in ["XS", "S", "M", "L", "XL"]:
                qty = item_data.get(size)
                if qty is None:
                    continue
                
                # Support standard SKU formats: "Product_Size" and "Product-Size"
                sku_variants = [
                    f"{product_name}_{size}",
                    f"{product_name}-{size}",
                    f"{product_name} {size}"
                ]
                
                for sku in sku_variants:
                    # Check if already present
                    res = await db.execute(
                        select(BomRecipeMaster).where(
                            BomRecipeMaster.fg_item_code == sku,
                            BomRecipeMaster.raw_material_code == RAW_MATERIAL_CODE
                        )
                    )
                    existing = res.scalars().first()
                    
                    if existing:
                        existing.qty = qty
                        existing.uom = "Meter"
                    else:
                        new_recipe = BomRecipeMaster(
                            fg_item_code=sku,
                            raw_material_code=RAW_MATERIAL_CODE,
                            qty=qty,
                            uom="Meter"
                        )
                        db.add(new_recipe)
                        inserted_count += 1
                        
        await db.commit()
        print(f"Successfully seeded/updated {inserted_count} BOM recipe variations in local database.")
        
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())
