from typing import TypedDict, List, Dict, Any, Optional
from datetime import datetime

class AgentState(TypedDict):
    # Unique identifier for the run
    run_id: str
    # Current date for planning
    planning_date: datetime
    # Date range for pulling orders from Shopify
    date_from: Optional[datetime]
    date_to: Optional[datetime]
    # Raw orders to process
    raw_orders: List[Dict[str, Any]]
    # IDs of orders successfully staged
    staged_order_ids: List[int]
    # SKUs that were classified successfully
    classified_skus: List[str]
    # Mapped ERPNext Material codes
    erp_material_codes: Optional[List[str]]
    # SKUs that failed or need exceptions
    exceptions: List[Dict[str, Any]]
    # Work order plans generated in this run
    work_order_plans: List[Dict[str, Any]]
    # Shortage / Manufacturing flags
    needs_manufacturing: bool
    has_shortage: bool
    has_in_stock: bool
