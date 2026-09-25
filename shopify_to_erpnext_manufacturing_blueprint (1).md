# Shopify → ERPNext Manufacturing Automation Blueprint

## Scope

This workflow will:

1. Pull **all paid Shopify orders**
2. Treat **every valid Shopify SKU as one ERPNext Finished Goods (FG) Item**
3. **Create FG Item in ERPNext if missing**
4. Use **BOM recipe table first**, then fall back to **LLM dynamic BOM proposal (Human-in-the-loop)** if missing
5. Create **one consolidated Work Order per SKU per day**
6. Push all missing **SKU / BOM / Raw Material** issues to an **exception queue**

---

# 1. Business Rules

## 1.1 Order Selection Rule
- Pull **all paid Shopify orders**
- Exclude:
  - cancelled orders
  - fully refunded orders
  - non-product lines such as gift cards / shipping / service lines where applicable

## 1.2 SKU to ERPNext Rule
- Each valid Shopify SKU = **one ERPNext Finished Goods Item**
- Example:

| Shopify SKU | ERPNext FG Item |
|---|---|
| NARAST002_M_BLUE | NARAST002_M_BLUE |
| NARASH010_L_WHITE | NARASH010_L_WHITE |

## 1.3 FG Item Creation Rule
- If a valid Shopify SKU does **not** exist in ERPNext Item Master:
  - create it automatically as a **Finished Goods Item**
- If it already exists:
  - reuse existing ERPNext Item

## 1.4 Fulfillment & Invoicing Rule
- After FG Item verification (1.3), check ERPNext stock balance for the FG Item.
- **If adequate stock is available:**
  - Create a **Sales Invoice** in ERPNext immediately.
  - Set Posting Date = Order Date.
  - Set Item = SKU, Quantity = Order Qty, Rate/Price = Order Price.
- **If stock is NOT available (or insufficient):**
  - Proceed to BOM Rule (1.5) and Work Order Rule (1.6) to manufacture the required items.
  - Once manufacturing is accounted for, follow up with the creation of the Sales Invoice.

## 1.5 BOM Rule
- BOM must be created **from the BOM recipe table** if available
- If BOM recipe is missing from the local database:
  - use an **LLM (Claude 3 Haiku)** to dynamically propose a BOM recipe (materials and quantities)
  - pause the pipeline and mandate **human-in-the-loop review** before proceeding
  - push the issue to **exception queue** if raw materials are missing in ERPNext

## 1.6 Work Order Rule
- Create **one consolidated Work Order per SKU per day**
- Formula:

```text
Net Work Order Qty = Open Paid Shopify Qty
                   - Available FG Stock
                   - Existing Open Work Order Qty
```

- If net quantity <= 0:
  - do not create Work Order
- If net quantity > 0:
  - create or update daily consolidated Work Order plan for that SKU

## 1.7 Exception Rule
Push to exception queue when any of the following is missing or invalid:
- SKU missing
- SKU not mapped / invalid
- ERP FG item creation failed
- BOM recipe missing
- Raw material item missing
- BOM creation failed
- Work Order creation failed
- Sales Invoice creation failed

---

# 2. End-to-End Process

## Step 1 — Pull all paid Shopify orders
**Agent:** Shopify Order Ingestion Agent

### Logic
1. Read Shopify orders from MCP / Shopify API
2. Filter to **paid orders**
3. Save raw order payload in raw staging table
4. Normalize and stage order header + order line records

### Output
- `shopify_order_raw`
- `stg_shopify_sales_order_hdr`
- `stg_shopify_sales_order_line`

---

## Step 2 — Identify valid manufacturable SKUs
**Agent:** SKU Classification Agent

### Logic
For each staged order line:
1. Read SKU
2. Validate that SKU is present
3. Exclude non-manufacturing lines if applicable
4. Mark line as manufacturable FG demand

### Output fields on staging line
- `sku`
- `erp_item_code`
- `manufacturing_type = MAKE`
- `processing_status = CLASSIFIED`

If SKU is missing, create exception queue entry.

---

## Step 3 — Create ERPNext FG Item if missing
**Agent:** ERPNext Item Master Agent

### Logic
For each distinct valid Shopify SKU:
1. Check if ERPNext Item already exists
2. If yes:
   - store mapping
   - mark as resolved
3. If no:
   - create ERPNext Item as Finished Goods item
   - fetch the auto-generated ERPNext Item Code (e.g., `STO-ITEM-...`)
   - update mapping table with this auto-generated code for all downstream APIs

### ERPNext Item rules
- `is_stock_item = 1`
- `is_sales_item = 1`
- `include_item_in_manufacturing = 1`
- `item_group = Finished Goods`
- `stock_uom = Nos`

### Output
- ERP FG Item exists for every valid sold SKU

---

## Step 4 — Check Stock & Fulfill Order
**Agent:** Fulfillment & Invoicing Agent

### Logic
For each validated Shopify SKU line:
1. Check ERPNext stock balance for the FG Item.
2. Determine available unallocated stock.
3. If `Available Stock >= Order Qty`:
   - Create a **Sales Invoice** in ERPNext immediately (Status: Draft/Submitted).
   - Set Posting Date = Order Date.
   - Set Item = SKU, Quantity = Order Qty, Rate = Order Price.
   - Mark order line as fulfilled.
4. If `Available Stock < Order Qty`:
   - Mark the remaining shortage (`Order Qty - Available Stock`) as unfulfilled demand.
   - Proceed to manufacturing steps.
   - Wait for manufacturing completion to generate the Sales Invoice.

### Output
- ERP Sales Invoices generated for items in stock.
- Unfulfilled demand passed to manufacturing planning.

---

## Step 5 — Create BOM only from BOM recipe table
**Agent:** BOM Generation Agent

### Logic
For each unfulfilled FG item demand:
1. Check if default active BOM already exists
2. If yes:
   - reuse it
3. If no:
   - read BOM lines from `bom_recipe_master`
   - validate all child raw materials exist
   - create BOM in ERPNext
4. If BOM recipe is missing:
   - invoke LLM (Anthropic Claude 3 Haiku) to propose a BOM recipe dynamically
   - pause pipeline for human review
   - if approved, create BOM in ERPNext
   - if rejected, create exception

### Strict rule
The system must **never** fully automate AI-guessed BOMs; any AI proposal requires strict human approval before proceeding.

### Output
- Valid default BOM exists for each manufacturable FG item requiring production.
- Missing BOMs routed to exception queue

---

## Step 6 — Create one consolidated Work Order per SKU per day
**Agent:** Work Order Planning Agent

### Consolidation Rule
Group unfulfilled demand by:
- `planning_date`
- `erp_fg_item_code`

### Demand logic
For each FG item:
1. Sum open **unfulfilled** paid Shopify demand for the day.
2. Fetch existing open Work Order quantity from ERPNext.
3. Compute net manufacturing quantity:

```text
Net Qty = Open Unfulfilled Demand - Open WO Qty
```

4. If net qty > 0:
   - create / update one consolidated Work Order plan row for that SKU and date
5. If net qty <= 0:
   - skip Work Order creation

### Output
- `stg_work_order_plan`

---

## Step 7 — Create ERPNext Work Order
**Agent:** ERPNext Work Order Creation Agent

### Logic
For each `stg_work_order_plan` row:
1. Validate FG item exists
2. Validate default BOM exists
3. Validate net quantity > 0
4. Check duplicate Work Order not already created for same SKU and date
5. Create ERPNext Work Order
6. Save ERP Work Order number back to staging

### Output
- One ERPNext Work Order per SKU per day where manufacturing qty is required

---

## Step 8 — Push all issues to exception queue
**Agent:** Exception Agent

### Exception cases
- Shopify line has no SKU
- SKU invalid / unmapped
- ERP FG Item creation failed
- Sales Invoice creation failed
- BOM recipe missing in `bom_recipe_master`
- Raw material item missing in ERPNext
- BOM creation failed
- Work Order creation failed

### Output
- `exception_queue`

---

# 3. Data Model

## 3.1 Raw order table
- `shopify_order_raw`

## 3.2 Staging order tables
- `stg_shopify_sales_order_hdr`
- `stg_shopify_sales_order_line` (now including `invoicing_status`)
- `stg_sales_invoice` (staged invoices before pushing to ERPNext)

## 3.3 Mapping table
- `map_shopify_sku_erp_item`

## 3.4 BOM recipe table
- `bom_recipe_master`

## 3.5 Work order plan table
- `stg_work_order_plan`

## 3.6 Exception table
- `exception_queue`

---

# 4. Processing Logic Summary

## 4.1 Paid Shopify Order Pull
- Pull all paid orders
- Stage header and lines

## 4.2 SKU to FG Mapping
- Every valid Shopify SKU = one ERP FG Item

## 4.3 FG Item Creation
- If ERP Item missing → create item

## 4.4 Fulfillment & Invoicing
- Check FG stock. 
- Create Sales Invoice if stock available.
- Pass shortage to manufacturing planning.

## 4.5 BOM Creation
- Use `bom_recipe_master` if available
- Fall back to LLM dynamic BOM proposal if missing (requires manual approval)
- Missing raw materials → exception

## 4.6 Work Order Planning
- Consolidate unfulfilled demand by SKU + day
- Create WO only for net shortage

## 4.7 Exception Handling
- Missing SKU / BOM / RM / ERP failures routed to queue

---

# 5. Daily Orchestration Sequence

## Frequency
Recommended: every 30 minutes or hourly

## Job Sequence
1. Pull paid Shopify orders
2. Stage order headers and lines
3. Classify valid SKUs
4. Create ERP FG Items if missing
5. Allocate stock and generate Sales Invoices for available items
6. Create BOMs from recipe table if missing for unfulfilled items
7. Aggregate unfulfilled demand by SKU per day
8. Create / update consolidated Work Order plan
9. Create ERPNext Work Orders
10. Push failures to exception queue

---

# 6. Final Operating Principle

This automation must behave as a **controlled manufacturing orchestration pipeline**, not as an uncontrolled sync.

### Hard rules:
- Only **paid Shopify orders**
- One Shopify SKU = one ERP FG Item
- Auto-create FG Item if missing
- **Fulfill orders from existing stock first via Sales Invoices**
- **Manufacture only the net shortage**
- BOM must come **from BOM recipe table** or be **explicitly approved by a human if proposed by AI**
- One consolidated Work Order per SKU per day
- Missing SKU / BOM / RM issues must always go to exception queue

---

# 7. Suggested File Name

`shopify_to_erpnext_manufacturing_blueprint.md`
