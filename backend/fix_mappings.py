import sqlite3

con = sqlite3.connect('produce_ai.db')
cur = con.cursor()

# 1. Fix Raahi Kurta L mapping
cur.execute("UPDATE map_shopify_sku_erp_item SET erp_item_code = 'NARA-MEN-RHI-L' WHERE shopify_sku LIKE '%Raahi%L%'")

# 2. Fix Idan Kurta mappings
cur.execute("UPDATE map_shopify_sku_erp_item SET erp_item_code = 'NARA-MEN-KUR-L' WHERE shopify_sku LIKE '%Idan%L%'")
cur.execute("UPDATE map_shopify_sku_erp_item SET erp_item_code = 'NARA-MEN-KUR-M' WHERE shopify_sku LIKE '%Idan%M%'")

# 3. Clean any invalid STO-ITEM-2026 placeholders that do not exist in ERPNext
cur.execute("DELETE FROM map_shopify_sku_erp_item WHERE erp_item_code IN ('STO-ITEM-2026-00012', 'STO-ITEM-2026-00013', 'STO-ITEM-2026-00014', 'STO-ITEM-2026-00015-L')")

con.commit()
print("Updated and cleaned invalid mappings successfully.")
con.close()
