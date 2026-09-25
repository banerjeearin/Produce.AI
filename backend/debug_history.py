import asyncio
from app.agents.orchestrator import orchestrator

def print_history(run_id: str):
    config = {"configurable": {"thread_id": run_id}}
    history = orchestrator.get_state_history(config)
    for state in history:
        print(f"Node: {state.next}")
        print(f"Tasks: {state.tasks}")
        for task in state.tasks:
            if task.error:
                print(f"Error in task: {task.error}")

print_history("7ca4786f-4c2c-421d-8e03-9da51f6388b0")
