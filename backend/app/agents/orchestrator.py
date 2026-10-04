from langgraph.graph import StateGraph, END
from app.agents.state import AgentState
from app.agents.ingestion import ingestion_agent
from app.agents.classification import classification_agent
from app.agents.item_master import item_master_agent
from app.agents.allocation import allocation_agent
from app.agents.invoicing import invoicing_agent
from app.agents.bom_generation import bom_generation_agent
from app.agents.planning import planning_agent
from app.agents.work_order import work_order_agent
from app.agents.exception import exception_agent
import uuid
from datetime import datetime

# Initialize the state graph
graph = StateGraph(AgentState)

# Add all agent nodes
graph.add_node("ingestion", ingestion_agent)
graph.add_node("classification", classification_agent)
graph.add_node("item_master", item_master_agent)
graph.add_node("allocation", allocation_agent)
graph.add_node("invoicing", invoicing_agent)
graph.add_node("bom_generation", bom_generation_agent)
graph.add_node("planning", planning_agent)
graph.add_node("work_order", work_order_agent)
graph.add_node("exception", exception_agent)

# Conditional routing after Allocation
def route_after_allocation(state: AgentState) -> str:
    has_in_stock = state.get("has_in_stock", False)
    has_shortage = state.get("has_shortage", False) or state.get("needs_manufacturing", False)
    
    if has_in_stock:
        return "invoicing"
    elif has_shortage:
        return "bom_generation"
    else:
        return "exception"

# Conditional routing after Invoicing
def check_manufacturing_needed(state: AgentState) -> str:
    if state.get("needs_manufacturing", False) or state.get("has_shortage", False):
        return "bom_generation"
    return "exception"

# Define edges
graph.add_edge("ingestion", "classification")
graph.add_edge("classification", "item_master")
graph.add_edge("item_master", "allocation")
graph.add_conditional_edges("allocation", route_after_allocation, {
    "invoicing": "invoicing",
    "bom_generation": "bom_generation",
    "exception": "exception"
})
graph.add_conditional_edges("invoicing", check_manufacturing_needed, {
    "bom_generation": "bom_generation",
    "exception": "exception"
})
graph.add_edge("bom_generation", "planning")
graph.add_edge("planning", "work_order")
graph.add_edge("work_order", "exception")
graph.add_edge("exception", END)

# Set entry point
graph.set_entry_point("ingestion")

interrupts = [
    "ingestion", "classification", "item_master", "allocation", 
    "invoicing", "bom_generation", "planning", "work_order"
]

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from datetime import datetime

async def run_pipeline(run_id: str, raw_orders: list = None, date_from=None, date_to=None):
    """
    Helper function to trigger the manufacturing pipeline.
    """
    initial_state = {
        "run_id": run_id,
        "planning_date": datetime.utcnow().date(),
        "date_from": date_from,
        "date_to": date_to,
        "raw_orders": raw_orders or [],
        "staged_order_ids": [],
        "classified_skus": [],
        "exceptions": []
    }
    
    config = {"configurable": {"thread_id": run_id}}
    
    async with AsyncSqliteSaver.from_conn_string("checkpoints.sqlite") as memory:
        orchestrator = graph.compile(checkpointer=memory, interrupt_after=interrupts)
        # Start the graph, it will pause after 'ingestion'
        final_state = await orchestrator.ainvoke(initial_state, config)
        return final_state

async def resume_pipeline(run_id: str):
    """
    Resumes a paused pipeline thread for a single stage.
    """
    config = {"configurable": {"thread_id": run_id}}
    async with AsyncSqliteSaver.from_conn_string("checkpoints.sqlite") as memory:
        orchestrator = graph.compile(checkpointer=memory, interrupt_after=interrupts)
        # Pass None to resume from the current checkpoint
        final_state = await orchestrator.ainvoke(None, config)
        return final_state

async def get_pipeline_state(run_id: str):
    """
    Returns the current StateSnapshot of the graph for the given run_id.
    """
    config = {"configurable": {"thread_id": run_id}}
    async with AsyncSqliteSaver.from_conn_string("checkpoints.sqlite") as memory:
        orchestrator = graph.compile(checkpointer=memory, interrupt_after=interrupts)
        return await orchestrator.aget_state(config)

async def auto_run_pipeline(run_id: str):
    """
    Auto-executes all remaining stages of a pipeline run until completion.
    """
    config = {"configurable": {"thread_id": run_id}}
    async with AsyncSqliteSaver.from_conn_string("checkpoints.sqlite") as memory:
        orchestrator = graph.compile(checkpointer=memory, interrupt_after=interrupts)
        state = await orchestrator.aget_state(config)
        while state and len(state.next) > 0:
            await orchestrator.ainvoke(None, config)
            state = await orchestrator.aget_state(config)
        return state

async def auto_run_all_active_runs(run_ids: list):
    """
    Mass executes all given run_ids through all pipeline stages.
    """
    for r_id in run_ids:
        try:
            await auto_run_pipeline(r_id)
        except Exception as e:
            print(f"Error auto-running pipeline {r_id}: {e}")




