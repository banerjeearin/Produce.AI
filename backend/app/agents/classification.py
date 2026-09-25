from sqlalchemy.future import select
from app.db.session import AsyncSessionLocal
from app.models import StgShopifySalesOrderLine, ProcessingStatus, ExceptionQueue, ExceptionStatus
from app.agents.state import AgentState

async def classification_agent(state: AgentState) -> AgentState:
    """
    Classification Agent:
    Validates SKUs and marks lines as CLASSIFIED. Flags missing SKUs as exceptions.
    """
    classified_skus = set(state.get("classified_skus", []))
    exceptions = state.get("exceptions", [])
    
    async with AsyncSessionLocal() as db:
        # Fetch all PENDING lines
        stmt = select(StgShopifySalesOrderLine).where(StgShopifySalesOrderLine.processing_status == ProcessingStatus.PENDING)
        result = await db.execute(stmt)
        pending_lines = result.scalars().all()
        
        for line in pending_lines:
            sku = line.sku
            if not sku or sku.strip() == "":
                # Exception: Missing SKU
                line.processing_status = ProcessingStatus.ERROR
                ex = ExceptionQueue(
                    error_type="MISSING_SKU",
                    description=f"Line ID {line.id} has no SKU.",
                    status=ExceptionStatus.OPEN
                )
                db.add(ex)
                exceptions.append({"type": "MISSING_SKU", "line_id": line.id})
            else:
                line.processing_status = ProcessingStatus.CLASSIFIED
                classified_skus.add(sku)
                
        await db.commit()
        
        if pending_lines:
            from app.models import ActivityLog, ActivityType
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="Classification",
                title="Orders Classified",
                description=f"Classified {len(pending_lines)} order lines. Unique SKUs: {', '.join(list(classified_skus))}",
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()

    return {
        "classified_skus": list(classified_skus),
        "exceptions": exceptions
    }
