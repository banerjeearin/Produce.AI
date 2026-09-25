import asyncio
from app.services.erpnext_client import ERPNextClient
from dotenv import load_dotenv

load_dotenv()

async def main():
    client = ERPNextClient()
    try:
        res = await client.client.get("/api/resource/Item?filters=[[\"item_name\",\"=\",\"Maxi Skirt_XS\"]]")
        print(res.json())
        res2 = await client.client.get("/api/resource/Item?filters=[[\"item_name\",\"=\",\"Corset Style Top_M\"]]")
        print(res2.json())
    finally:
        await client.close()

asyncio.run(main())
