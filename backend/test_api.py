import asyncio
import os
import json
from dotenv import load_dotenv
load_dotenv()
from app.services.erpnext_client import ERPNextClient

async def run():
    client = ERPNextClient()
    company = os.getenv("ERPNEXT_COMPANY")
    try:
        print("\nFetching stock balance with ignore_prepared_report...")
        payload = {
            "report_name": "Stock Balance",
            "filters": {
                "company": company,
                "to_date": "2025-03-31"
            },
            "ignore_prepared_report": 1
        }
        resp = await client.client.post("/api/method/frappe.desk.query_report.run", json=payload)
        data = resp.json()
        if "message" in data:
            msg = data["message"]
            result = msg.get("result", [])
            for i, row in enumerate(result):
                if isinstance(row, list):
                    print(f"Row {i} is a LIST! {row}")
                elif not isinstance(row, dict):
                    print(f"Row {i} is {type(row)}: {row}")
            print("Checked all rows.")
        else:
            print("No message")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(run())
