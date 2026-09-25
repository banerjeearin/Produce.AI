import os
import re

files_to_patch = {
    "item_master.py": ("""    return {
        "erp_items": list(erp_items),
        "exceptions": exceptions
    }""", """
    from app.models import ActivityLog, ActivityType
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        if erp_items:
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="Item Master",
                title="Item Master Mapping",
                description=f"Mapped {len(erp_items)} SKUs to ERP items.",
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()

    return {
        "erp_items": list(erp_items),
        "exceptions": exceptions
    }"""),
    
    "bom_generation.py": ("""    return {
        "boms_verified": boms_verified,
        "exceptions": exceptions
    }""", """
    from app.models import ActivityLog, ActivityType
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        if boms_verified:
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="BOM Generation",
                title="BOM Verified",
                description=f"Verified BOMs for {len(boms_verified)} ERP items.",
                type=ActivityType.SUCCESS
            )
            db.add(log)
            await db.commit()
            
    return {
        "boms_verified": boms_verified,
        "exceptions": exceptions
    }"""),
    
    "planning.py": ("""    return {
        "exceptions": exceptions
    }""", """
    from app.models import ActivityLog, ActivityType
    async with AsyncSessionLocal() as db:
        log = ActivityLog(
            run_id=state.get("run_id"),
            agent_name="Planning",
            title="Production Planning",
            description=f"Generated production plans for date {planning_date}.",
            type=ActivityType.SUCCESS
        )
        db.add(log)
        await db.commit()
        
    return {
        "exceptions": exceptions
    }"""),
    
    "exception.py": ("""    return state""", """
    from app.models import ActivityLog, ActivityType
    from app.db.session import AsyncSessionLocal
    exceptions = state.get("exceptions", [])
    if exceptions:
        async with AsyncSessionLocal() as db:
            log = ActivityLog(
                run_id=state.get("run_id"),
                agent_name="Exception",
                title="Exceptions Logged",
                description=f"Registered {len(exceptions)} exceptions.",
                type=ActivityType.WARNING
            )
            db.add(log)
            await db.commit()
            
    return state""")
}

for filename, (search, replace) in files_to_patch.items():
    filepath = f"app/agents/{filename}"
    if os.path.exists(filepath):
        with open(filepath, "r") as f:
            content = f.read()
        if search in content:
            content = content.replace(search, replace)
            with open(filepath, "w") as f:
                f.write(content)
            print(f"Patched {filename}")
        else:
            print(f"Search string not found in {filename}")
    else:
        print(f"File {filename} not found")

