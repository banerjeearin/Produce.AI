import os
import asyncio
from datetime import datetime
from dotenv import load_dotenv
from app.agents.ingestion import fetch_shopify_orders

load_dotenv()

async def test():
    d1 = datetime.strptime("19.03.2026", "%d.%m.%Y")
    d2 = datetime.strptime("31.03.2026", "%d.%m.%Y")
    orders = await fetch_shopify_orders(d1, d2)
    print(f"Orders between 19.03.2026 and 31.03.2026: {len(orders)}")

asyncio.run(test())
