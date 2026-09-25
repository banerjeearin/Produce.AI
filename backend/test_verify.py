import asyncio
from app.api.pipeline import delete_run_data
from app.api.pipeline import PipelineRequest
from app.services.shopify_client import fetch_shopify_orders
from app.agents.orchestrator import run_pipeline, get_pipeline_state

async def main():
    run_id = "4071a230-d60c-4978-b632-207d5fc78973"
    print(await delete_run_data(run_id))

    # wait I shouldn't just run delete_run_data, it's easier to just use the api 
    # to trigger a new run 

asyncio.run(main())
