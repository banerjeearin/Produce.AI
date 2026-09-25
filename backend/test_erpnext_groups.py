import asyncio
import os
from dotenv import load_dotenv
load_dotenv()
from app.services.erpnext_client import ERPNextClient
import httpx

async def test():
    client = ERPNextClient()
    try:
        res = await client.client.get("/api/resource/Item Group?fields=[\"name\"]")
        print("Groups:", res.json().get("data", []))
    except Exception as e:
        print("Error:", e)
    await client.close()

asyncio.run(test())
