import asyncio
from app.agents.orchestrator import get_pipeline_state
from dotenv import load_dotenv
load_dotenv()

async def main():
    try:
        run_id = "4071a230-d60c-4978-b632-207d5fc78973"
        snapshot = await get_pipeline_state(run_id)
        if snapshot:
            print("Next nodes:", snapshot.next)
        else:
            print("Snapshot not found")
    except Exception as e:
        print("Exception:", str(e))

asyncio.run(main())
