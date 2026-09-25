import asyncio
from app.services.erpnext_client import ERPNextClient
from dotenv import load_dotenv

load_dotenv()

async def main():
    erp = ERPNextClient()
    item = await erp.get_item("Maxi Skirt_XS")
    print("Item:", item)
    if not item:
        try:
            print("Creating item...")
            payload = {
                "item_code": "Maxi Skirt_XS",
                "item_name": "Maxi Skirt_XS",
                "item_group": "Products",
                "is_stock_item": 1,
                "is_sales_item": 1,
                "include_item_in_manufacturing": 1,
                "stock_uom": "Nos"
            }
            res = await erp.create_item(payload)
            print("Created:", res)
        except Exception as e:
            print("Create Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
