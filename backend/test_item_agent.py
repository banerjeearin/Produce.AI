import asyncio
from app.agents.item_master import item_master_agent
from dotenv import load_dotenv

load_dotenv()

async def main():
    state = {
        "run_id": "852baf35-17bb-4f3b-977e-f407b956de77",
        "classified_skus": ["Maxi Skirt_XS"],
        "exceptions": []
    }
    new_state = await item_master_agent(state)
    print("New state:", new_state)

if __name__ == "__main__":
    asyncio.run(main())
