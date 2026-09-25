import asyncio
from pydantic import BaseModel, Field
from typing import List
from langchain_google_genai import ChatGoogleGenerativeAI
from dotenv import load_dotenv
import os

load_dotenv()

class RecipeLine(BaseModel):
    raw_material_code: str = Field(description="The ERPNext item_code of the raw material to use.")
    qty: float = Field(description="The required quantity of this raw material.")
    uom: str = Field(description="The Unit of Measure (UOM) for this raw material, e.g., 'Nos', 'm', 'kg'")

class BomRecipe(BaseModel):
    lines: List[RecipeLine] = Field(description="The list of raw materials needed for this finished good.")

async def main():
    llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash", temperature=0.0)
    structured_llm = llm.with_structured_output(BomRecipe)
    
    sku = "Maxi Skirt_XS"
    available_rms = [
        {"item_code": "Fabric_Cotton", "stock_uom": "Nos"},
        {"item_code": "Fabric_Polyester", "stock_uom": "Nos"},
        {"item_code": "Button_Small", "stock_uom": "Nos"},
    ]
    
    prompt = f"Propose a reasonable Bill of Materials (BOM) recipe for the SKU: '{sku}'.\n\nYou MUST ONLY select from the following available raw materials:\n"
    for rm in available_rms:
        prompt += f"- {rm['item_code']} (UOM: {rm['stock_uom']})\n"
        
    prompt += "\nOutput the selected raw materials and quantities required to produce 1 unit of the finished good."
    
    res = await structured_llm.ainvoke(prompt)
    print(res)

if __name__ == "__main__":
    asyncio.run(main())
