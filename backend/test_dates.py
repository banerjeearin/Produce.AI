import os
import asyncio
from datetime import datetime
from dotenv import load_dotenv
from app.agents.ingestion import fetch_shopify_orders

load_dotenv()

async def test():
    d = datetime.strptime("19.07.2026", "%d.%m.%Y")
    orders = await fetch_shopify_orders(d, d)
    print(f"Total orders fetched for 19.07.2026: {len(orders)}")

asyncio.run(test())
