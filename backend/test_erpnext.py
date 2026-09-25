import asyncio
import os
from dotenv import load_dotenv
load_dotenv()
from app.services.erpnext_client import ERPNextClient
import httpx

async def test():
    client = ERPNextClient()
    payload = {
        "item_code": "Maxi Skirt_XS",
        "item_name": "Maxi Skirt_XS",
        "item_group": "Finished Goods",
        "is_stock_item": 1,
        "is_sales_item": 1,
        "include_item_in_manufacturing": 1,
        "stock_uom": "Nos"
    }
    try:
        res = await client.create_item(payload)
        print("Success:", res)
    except httpx.HTTPStatusError as e:
        print("Error:", e)
        print("Response:", e.response.text)
    await client.close()

asyncio.run(test())
