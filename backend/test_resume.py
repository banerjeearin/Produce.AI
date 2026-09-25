import asyncio
from app.agents.orchestrator import resume_pipeline
from dotenv import load_dotenv
load_dotenv()

async def main():
    try:
        run_id = "4071a230-d60c-4978-b632-207d5fc78973"
        print("Resuming pipeline for run_id:", run_id)
        result = await resume_pipeline(run_id)
        print("Pipeline resumed successfully:", result)
    except Exception as e:
        print("Exception during resume:", str(e))
        import traceback
        traceback.print_exc()

asyncio.run(main())
