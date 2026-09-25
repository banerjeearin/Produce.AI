import os
import httpx
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

async def fetch_shopify_orders(date_from: Optional[datetime], date_to: Optional[datetime]) -> list:
    store_url = os.environ.get("SHOPIFY_STORE_URL")
    access_token = os.environ.get("SHOPIFY_ACCESS_TOKEN")
    
    if not store_url or not access_token:
        logger.warning("SHOPIFY_STORE_URL or SHOPIFY_ACCESS_TOKEN not set. Cannot fetch from real API.")
        return []
        
    url = f"https://{store_url}/admin/api/2024-01/orders.json"
    
    params = {"status": "any", "limit": 250}
    if date_from:
        params["created_at_min"] = date_from.isoformat()
    if date_to:
        params["created_at_max"] = date_to.isoformat()
        
    headers = {
        "X-Shopify-Access-Token": access_token,
        "Content-Type": "application/json"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            logger.info(f"Fetching from Shopify: {url}")
            response = await client.get(url, params=params, headers=headers)
            response.raise_for_status()
            data = response.json()
            orders = data.get("orders", [])
            logger.info(f"Fetched {len(orders)} orders from Shopify.")
            return orders
        except Exception as e:
            logger.error(f"Failed to fetch orders from Shopify: {e}")
            return []
