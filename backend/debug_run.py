import asyncio
from app.api.pipeline import get_pipeline_state

snapshot = get_pipeline_state("7ca4786f-4c2c-421d-8e03-9da51f6388b0")
if snapshot:
    print("Next nodes:", snapshot.next)
    print("Tasks:", snapshot.tasks)
    print("Errors:", [t.error for t in snapshot.tasks if t.error])
else:
    print("Snapshot not found")
