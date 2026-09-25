import asyncio
from app.agents.bom_generation import bom_generation_agent
from dotenv import load_dotenv

load_dotenv()

async def main():
    state = {
        "run_id": "240198f9-fa43-4ea7-a96b-7847904747bc",
        "classified_skus": ["Maxi Skirt_XS"],
        "exceptions": []
    }
    new_state = await bom_generation_agent(state)
    print("New state:", new_state)

if __name__ == "__main__":
    asyncio.run(main())
