import logging
from app.agents.state import AgentState
from app.models import ActivityLog, ActivityType, ExceptionQueue, ExceptionStatus
from app.db.session import AsyncSessionLocal
from app.services.llm_client import LLMClient
from sqlalchemy.future import select

logger = logging.getLogger(__name__)

async def exception_agent(state: AgentState) -> AgentState:
    """
    Exception Agent:
    Monitors the exceptions generated in the current run, uses an LLM to generate
    resolution notes, and saves them to the ExceptionQueue.
    """
    exceptions = state.get("exceptions", [])
    
    if not exceptions:
        logger.info("Pipeline completed with 0 exceptions.")
        return state

    llm = LLMClient()
    
    async with AsyncSessionLocal() as db:
        # Fetch the exceptions we just created in this run
        stmt = select(ExceptionQueue).where(ExceptionQueue.run_id == state.get("run_id"))
        result = await db.execute(stmt)
        db_exceptions = result.scalars().all()

        for ex in db_exceptions:
            # Generate resolution using LLM
            resolution = await llm.analyze_exception(
                error_type=ex.error_type,
                related_sku=ex.related_sku,
                description=ex.description
            )
            ex.resolution_notes = resolution

        await db.commit()
        
        log = ActivityLog(
            run_id=state.get("run_id"),
            agent_name="Exception",
            title="Exceptions Logged & Analyzed",
            description=f"Registered and analyzed {len(exceptions)} exceptions using LLM.",
            type=ActivityType.WARNING
        )
        db.add(log)
        await db.commit()

    return state
