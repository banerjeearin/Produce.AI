import os
import asyncio
from dotenv import load_dotenv
from app.agents.ingestion import fetch_shopify_orders

load_dotenv()

async def test():
    orders = await fetch_shopify_orders(None, None)
    print(f"Total orders fetched: {len(orders)}")

asyncio.run(test())
