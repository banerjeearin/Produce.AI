import asyncio
from app.services.erpnext_client import ERPNextClient
from dotenv import load_dotenv
load_dotenv()

async def main():
    client = ERPNextClient()
    qty = await client.get_available_stock("Maxi Skirt_XS")
    print("Available stock for Maxi Skirt_XS:", qty)
    await client.close()

asyncio.run(main())
