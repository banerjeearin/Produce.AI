import asyncio
from app.db.session import AsyncSessionLocal
from app.models import BomRecipeMaster
from app.services.erpnext_client import ERPNextClient
from sqlalchemy.future import select
import httpx
from dotenv import load_dotenv

load_dotenv()

async def main():
    skus = [
        "Maxi Skirt_XS",
        "Corset Style Top_M",
        "Laidback Luxe Trouser-L",
        "Maxi Skirt_M",
        "Laidback Luxe Trouser-M"
    ]
    
    raw_materials = {
        "Fabric_Cotton": {"item_group": "Raw Material", "stock_uom": "Nos"},
        "Fabric_Polyester": {"item_group": "Raw Material", "stock_uom": "Nos"}
    }
    
    client = ERPNextClient()
    
    # 1. Create Raw Materials in ERPNext
    for rm_code, props in raw_materials.items():
        try:
            item = await client.get_item(rm_code)
            if not item:
                payload = {
                    "item_code": rm_code,
                    "item_name": rm_code,
                    "item_group": props["item_group"],
                    "is_stock_item": 1,
                    "is_sales_item": 0,
                    "include_item_in_manufacturing": 1,
                    "stock_uom": props["stock_uom"]
                }
                await client.create_item(payload)
                print(f"Created RM {rm_code} in ERPNext")
            else:
                print(f"RM {rm_code} already exists in ERPNext")
        except httpx.HTTPStatusError as e:
            print(f"Failed to create RM {rm_code} in ERPNext: {e}")
            if hasattr(e, 'response'):
                print(e.response.text)
                
    # 2. Add BOM Recipes locally
    async with AsyncSessionLocal() as db:
        for sku in skus:
            # Check if recipe already exists
            result = await db.execute(
                select(BomRecipeMaster).where(BomRecipeMaster.fg_item_code == sku)
            )
            if not result.scalars().first():
                # Add dummy recipe: 2 meters of Cotton Fabric
                recipe1 = BomRecipeMaster(
                    fg_item_code=sku,
                    raw_material_code="Fabric_Cotton",
                    qty=2.0,
                    uom="Nos"
                )
                db.add(recipe1)
                
                # And 1 meter of Polyester Fabric
                recipe2 = BomRecipeMaster(
                    fg_item_code=sku,
                    raw_material_code="Fabric_Polyester",
                    qty=1.0,
                    uom="Nos"
                )
                db.add(recipe2)
                print(f"Added local recipe for {sku}")
                
        await db.commit()
    
    await client.close()
    print("Seeding complete.")

if __name__ == "__main__":
    asyncio.run(main())
