import asyncio
from app.db.session import engine, Base
from app.models import ActivityLog

async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Recreated activity_log table.")

asyncio.run(main())
