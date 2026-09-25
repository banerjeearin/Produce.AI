import asyncio
from app.services.erpnext_client import ERPNextClient
from dotenv import load_dotenv

load_dotenv()

async def main():
    client = ERPNextClient()
    payload = {
        "item_code": "Corset Style Top_M",
        "item_name": "Corset Style Top_M",
        "item_group": "Products",
        "is_stock_item": 1,
        "is_sales_item": 1,
        "include_item_in_manufacturing": 1,
        "stock_uom": "Nos"
    }
    try:
        res = await client.create_item(payload)
        print("Success:", res)
    except Exception as e:
        print("Exception:", str(e))
        if hasattr(e, "response"):
            print("Response:", e.response.text)
    finally:
        await client.close()

asyncio.run(main())
