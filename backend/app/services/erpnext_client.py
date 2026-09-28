import httpx
import os
from typing import Dict, Any, Optional

class ERPNextClient:
    def __init__(self, base_url: str = None, api_key: str = None, api_secret: str = None):
        self.base_url = base_url or os.getenv("ERPNEXT_URL", "http://localhost:8000")
        self.api_key = api_key or os.getenv("ERPNEXT_API_KEY")
        self.api_secret = api_secret or os.getenv("ERPNEXT_API_SECRET")
        
        self.headers = {
            "Authorization": f"token {self.api_key}:{self.api_secret}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        self.client = httpx.AsyncClient(base_url=self.base_url, headers=self.headers, timeout=30.0)

    async def get_item(self, item_code: str) -> Optional[Dict[str, Any]]:
        # 1. Try exact match on item_code (primary key)
        response = await self.client.get(f"/api/resource/Item/{item_code}")
        if response.status_code == 200:
            return response.json().get("data")
            
        # 2. If 404, fallback to searching by item_name (exact then like)
        if response.status_code == 404:
            # 2a. Exact item_name
            params = {
                "filters": f'[["item_name", "=", "{item_code}"]]',
                "fields": '["name", "item_code", "item_name"]'
            }
            search_resp = await self.client.get("/api/resource/Item", params=params)
            if search_resp.status_code == 200:
                data = search_resp.json().get("data", [])
                if data:
                    return data[0]

            # 2b. Like matches (handling _ and -)
            variations = [item_code, item_code.replace("_", "-"), item_code.replace("_", " "), item_code.replace("-", " ")]
            for v in variations:
                clean_v = v.strip()
                if clean_v:
                    params_like = {
                        "filters": f'[["item_name", "like", "%{clean_v}%"]]',
                        "fields": '["name", "item_code", "item_name"]'
                    }
                    resp_like = await self.client.get("/api/resource/Item", params=params_like)
                    if resp_like.status_code == 200:
                        data_like = resp_like.json().get("data", [])
                        if data_like:
                            return data_like[0]
            return None
            
        response.raise_for_status()

    async def create_item(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        response = await self.client.post("/api/resource/Item", json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise Exception(f"Failed to create item. Status: {e.response.status_code}. Response: {e.response.text}") from e
        return response.json().get("data")

    async def get_raw_materials(self) -> list:
        params = {
            "filters": '[["item_group", "=", "Raw Material"]]',
            "fields": '["name", "item_code", "item_name", "stock_uom"]',
            "limit_page_length": 1000
        }
        response = await self.client.get("/api/resource/Item", params=params)
        response.raise_for_status()
        return response.json().get("data", [])

    async def get_bom(self, item_code: str) -> Optional[Dict[str, Any]]:
        # Find default active BOM for item
        params = {
            "filters": f'[["item", "=", "{item_code}"], ["is_active", "=", 1], ["is_default", "=", 1]]',
            "fields": '["name"]'
        }
        response = await self.client.get("/api/resource/BOM", params=params)
        response.raise_for_status()
        data = response.json().get("data", [])
        return data[0] if data else None

    async def create_bom(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        response = await self.client.post("/api/resource/BOM", json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise Exception(f"Failed to create BOM. Status: {e.response.status_code}. Response: {e.response.text}") from e
        return response.json().get("data")
        
    async def get_available_stock(self, item_code: str) -> float:
        params = {
            "filters": f'[["item_code", "=", "{item_code}"]]',
            "fields": '["actual_qty"]'
        }
        response = await self.client.get("/api/resource/Bin", params=params)
        response.raise_for_status()
        bins = response.json().get("data", [])
        return sum(b.get("actual_qty", 0.0) for b in bins)

    async def get_open_work_orders_qty(self, item_code: str) -> float:
        params = {
            "filters": f'[["production_item", "=", "{item_code}"], ["status", "in", ["Draft", "Not Started", "In Progress"]]]',
            "fields": '["qty", "produced_qty"]'
        }
        response = await self.client.get("/api/resource/Work Order", params=params)
        response.raise_for_status()
        wos = response.json().get("data", [])
        # Net open qty is qty - produced_qty
        return sum(wo.get("qty", 0.0) - wo.get("produced_qty", 0.0) for wo in wos)

    async def create_work_order(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        response = await self.client.post("/api/resource/Work Order", json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise Exception(f"Failed to create work order. Status: {e.response.status_code}. Response: {e.response.text}") from e
        return response.json().get("data")

    async def get_stock_balance_report(self, date_as_on: str, company: str = None) -> list:
        filters = {
            "to_date": date_as_on
        }
        if company:
            filters["company"] = company
            
        payload = {
            "report_name": "Stock Balance",
            "filters": filters,
            "ignore_prepared_report": True
        }
        response = await self.client.post("/api/method/frappe.desk.query_report.run", json=payload)
        response.raise_for_status()
        data = response.json().get("message", {})
        return data.get("result", [])

    async def close(self):
        await self.client.aclose()
