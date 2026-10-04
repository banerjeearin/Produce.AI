import asyncio
from dotenv import load_dotenv
load_dotenv()
from app.services.erpnext_client import ERPNextClient

async def inspect():
    client = ERPNextClient()
    try:
        # 1. Fetch Item fields
        res_items = await client.client.get('/api/resource/Item?fields=["name","item_code","item_name","default_bom"]&limit_page_length=20')
        print("Item HTTP:", res_items.status_code)
        items_data = res_items.json().get("data", [])
        items_with_bom = [it for it in items_data if it.get("default_bom")]
        print(f"Items with default_bom in first 20: {len(items_with_bom)}")
        for it in items_with_bom:
            print("Item:", it["name"], "default_bom:", it["default_bom"])

        # 2. Fetch BOMs
        res_boms = await client.client.get('/api/resource/BOM?fields=["name","item","is_active","is_default"]&limit_page_length=100')
        print("BOM HTTP:", res_boms.status_code)
        boms_data = res_boms.json().get("data", [])
        print(f"Total BOMs found in ERPNext: {len(boms_data)}")
        for b in boms_data[:10]:
            print("BOM:", b["name"], "for Item:", b.get("item"), "Active:", b.get("is_active"), "Default:", b.get("is_default"))
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(inspect())
