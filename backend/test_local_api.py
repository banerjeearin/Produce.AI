import asyncio
import httpx

async def run():
    async with httpx.AsyncClient() as client:
        try:
            print("Calling /api/dashboard/inventory...")
            response = await client.get("http://localhost:8000/api/dashboard/inventory?date=2025-03-31")
            print(f"Status Code: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"Data count: {len(data.get('data', []))}")
                if len(data.get('data', [])) > 0:
                    print(f"First item: {data['data'][0]}")
                else:
                    print("List is empty!")
            else:
                print(f"Error Body: {response.text}")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(run())
