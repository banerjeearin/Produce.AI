import asyncio
from langgraph.checkpoint.aiosqlite import AsyncSqliteSaver
from app.agents.orchestrator import graph, interrupts

async def main():
    run_id = "240198f9-fa43-4ea7-a96b-7847904747bc"
    config = {"configurable": {"thread_id": run_id}}
    async with AsyncSqliteSaver.from_conn_string("checkpoints.sqlite") as memory:
        orchestrator = graph.compile(checkpointer=memory, interrupt_after=interrupts)
        
        # Get current state
        state = await orchestrator.aget_state(config)
        print("Current Exceptions:", state.values.get("exceptions", []))
        
        # Update state: empty exceptions list
        await orchestrator.aupdate_state(config, {"exceptions": []})
        
        # Get updated state
        new_state = await orchestrator.aget_state(config)
        print("Updated Exceptions:", new_state.values.get("exceptions", []))

if __name__ == "__main__":
    asyncio.run(main())
