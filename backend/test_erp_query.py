import asyncio
from app.services.erpnext_client import ERPNextClient
from dotenv import load_dotenv

load_dotenv()

async def main():
    client = ERPNextClient()
    try:
        res = await client.client.get("/api/resource/Item?limit_page_length=50")
        print(res.json())
    finally:
        await client.close()

asyncio.run(main())
