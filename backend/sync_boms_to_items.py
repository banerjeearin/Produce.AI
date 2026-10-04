import asyncio
from dotenv import load_dotenv
load_dotenv()
from app.services.erpnext_client import ERPNextClient

async def sync_all_existing_boms_to_items():
    client = ERPNextClient()
    try:
        # Fetch all active default BOMs from ERPNext
        boms_resp = await client.client.get('/api/resource/BOM?fields=["name","item","is_active","is_default"]&limit_page_length=500')
        boms = boms_resp.json().get("data", [])
        print(f"Total BOMs in ERPNext: {len(boms)}")
        
        # Group by item: prefer default BOM
        item_to_bom = {}
        for b in boms:
            if b.get("is_active") and b.get("item"):
                item_code = b["item"]
                if item_code not in item_to_bom or b.get("is_default"):
                    item_to_bom[item_code] = b["name"]

        updated_count = 0
        already_linked_count = 0
        failed_count = 0

        for item_code, bom_name in item_to_bom.items():
            try:
                item_resp = await client.client.get(f"/api/resource/Item/{item_code}")
                if item_resp.status_code == 200:
                    current_default = item_resp.json().get("data", {}).get("default_bom")
                    if current_default == bom_name:
                        already_linked_count += 1
                        continue
                    
                    # Update ERPNext Material Master
                    res_update = await client.client.put(f"/api/resource/Item/{item_code}", json={"default_bom": bom_name})
                    if res_update.status_code == 200:
                        updated_count += 1
                        print(f"Linked {bom_name} -> Item {item_code}")
                    else:
                        failed_count += 1
            except Exception as e:
                failed_count += 1

        print(f"\nSync complete:")
        print(f" - Newly linked: {updated_count}")
        print(f" - Already linked: {already_linked_count}")
        print(f" - Failed/Skipped: {failed_count}")
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(sync_all_existing_boms_to_items())
