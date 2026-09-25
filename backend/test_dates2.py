import os
import asyncio
from dotenv import load_dotenv
from app.agents.ingestion import fetch_shopify_orders

load_dotenv()

async def test():
    orders = await fetch_shopify_orders(None, None)
    print(f"Total orders fetched: {len(orders)}")
    if orders:
        dates = [o.get("created_at") for o in orders if o.get("created_at")]
        dates.sort()
        print(f"Earliest order: {dates[0]}")
        print(f"Latest order: {dates[-1]}")

asyncio.run(test())
