#!/usr/bin/env python3
"""
NaraWear: build ERPNext item templates + size variants from the Shopify catalogue.

Replays what was done by hand on 3-4 Oct 2026. Shopify is never modified.

What it does (each step is idempotent, so it is safe to re-run):
  1. Creates Custom Fields on Item: "Shopify Variant ID", "Shopify SKU".
  2. Reads every Shopify product/variant (Admin GraphQL).
  3. For each ACTIVE/DRAFT product:
       - finds ERPNext items that already carry one of its SKUs
         (item_code == SKU, or shopify_variant_id == variant id);
       - if a sibling is already a variant, new sizes are added under that template;
         otherwise a new template is created with code = SKU minus size token
         (or the code in BLANK_SKU_TEMPLATES for products with no SKU);
       - creates missing variants with item_code = SKU verbatim, Size attribute from
         the Shopify Size option, shopify_selling_rate, variant id, SKU, image, description.
  4. Archived products are skipped.
  5. Optionally (--backfill) fills Shopify Variant ID / SKU on items that already
     exist and match a Shopify SKU exactly.
  Nothing is ever deleted or merged. Leftover hand-made duplicates are only REPORTED.

Setup:
  Uses environment variables from .env if present (ERPNEXT_URL or ERP_URL, SHOPIFY_STORE_URL or SHOPIFY_STORE, etc.)

Usage:
  python sync_shopify_to_erpnext.py                 # dry run, prints the plan
  python sync_shopify_to_erpnext.py --apply         # executes
  python sync_shopify_to_erpnext.py --apply --only "Sitara Top"   # one product (pilot)
  python sync_shopify_to_erpnext.py --apply --backfill
"""
import argparse, html, os, re, sys, collections
import requests
from dotenv import load_dotenv

load_dotenv()

# ---- configuration -------------------------------------------------------
REFERENCE_ITEM = "NARA-SIT-WHT"          # existing template whose flags are copied
COMPANY = os.getenv("ERPNEXT_COMPANY", "Aaishka Industries Pvt. Ltd.")  # <-- set to your ERPNext Company name
DEFAULT_WAREHOUSE = "Stores - AIPL"
ITEM_GROUP = "All Item Groups"
UOM = "Nos"
SIZE_ATTR = "Size"
SIZE_VALUE = {"XS": "Extra Small", "S": "Small", "M": "Medium", "L": "Large",
              "XL": "Extra Large", "F": "F", "XXS": "XXS"}
SIZE_ORDER = {"XXS": 0, "XS": 1, "S": 2, "M": 3, "L": 4, "XL": 5, "F": 6}
# Products with no Shopify SKU -> template code (variant code = template-SIZE).
# Colour segment NVY / BGR added because these are later colourways.
BLANK_SKU_TEMPLATES = {
    "The Plum Top (Navy stripes)": "NARA-PLM-TOP-NVY",
    "Celeste Halter Top (Blue-Green)": "NARA-CEL-TOP-BGR",
}
# For these templates the Shopify SKU is stored blank in ERPNext (mirrors Shopify).
SKIP_STATUS = {"ARCHIVED"}

# ---- helpers -------------------------------------------------------------
def stem(sku, size):
    """SKU with the size token removed."""
    for pat in (r"[-_]" + re.escape(size) + r"$", r"[-_]" + re.escape(size) + r"(?=_)", r"-\d$"):
        n = re.sub(pat, "", sku)
        if n != sku:
            return n
    return sku


class Erp:
    def __init__(self):
        self.base = (os.getenv("ERP_URL") or os.getenv("ERPNEXT_URL") or "https://narawear.nvi.frappe.cloud").rstrip("/")
        api_key = os.getenv("ERP_API_KEY") or os.getenv("ERPNEXT_API_KEY")
        api_secret = os.getenv("ERP_API_SECRET") or os.getenv("ERPNEXT_API_SECRET")
        self.s = requests.Session()
        self.s.headers["Authorization"] = f"token {api_key}:{api_secret}"

    def get(self, path, **params):
        r = self.s.get(self.base + path, params=params, timeout=60)
        r.raise_for_status()
        return r.json()

    def post(self, path, payload):
        r = self.s.post(self.base + path, json=payload, timeout=60)
        if not r.ok:
            raise RuntimeError("%s -> %s %s" % (path, r.status_code, r.text[:500]))
        return r.json()

    def exists(self, doctype, name):
        r = self.s.get("%s/api/resource/%s/%s" % (self.base, doctype, requests.utils.quote(name, safe="")), timeout=60)
        return r.status_code == 200

    def items(self, filters, fields):
        import json
        out, start = [], 0
        while True:
            d = self.get("/api/resource/Item", filters=json.dumps(filters), fields=json.dumps(fields),
                         limit_start=start, limit_page_length=500)["data"]
            out += d
            if len(d) < 500:
                return out
            start += 500


def shopify_variants():
    store = os.getenv("SHOPIFY_STORE") or os.getenv("SHOPIFY_STORE_URL")
    token = os.getenv("SHOPIFY_TOKEN") or os.getenv("SHOPIFY_ACCESS_TOKEN")
    q = """query($c:String){productVariants(first:100,after:$c){pageInfo{hasNextPage endCursor}
      nodes{id sku price selectedOptions{name value}
        product{id title status description featuredImage{url}}}}}"""
    rows, cur = [], None
    while True:
        r = requests.post("https://%s/admin/api/2025-01/graphql.json" % store,
                          json={"query": q, "variables": {"c": cur}},
                          headers={"X-Shopify-Access-Token": token}, timeout=60)
        r.raise_for_status()
        d = r.json()["data"]["productVariants"]
        for n in d["nodes"]:
            size = next((o["value"] for o in n["selectedOptions"] if o["name"].lower() == "size"), None)
            p = n["product"]
            rows.append(dict(vid=n["id"].rsplit("/", 1)[1], sku=(n["sku"] or "").strip(), size=size,
                             price=float(n["price"] or 0), pid=p["id"], product=p["title"], status=p["status"],
                             desc=p["description"] or "", image=(p["featuredImage"] or {}).get("url")))
        if not d["pageInfo"]["hasNextPage"]:
            return rows
        cur = d["pageInfo"]["endCursor"]


def psv_variants(path):
    rows = []
    for ln in open(path, encoding="utf-8").read().splitlines()[1:]:
        v, sku, size, price, pid, prod, st = ln.split("|")
        rows.append(dict(vid=v, sku=sku, size=size, price=float(price or 0), pid=pid, product=prod,
                         status=st, desc="", image=None))
    return rows


def ensure_custom_fields(erp, apply):
    fields = [("shopify_variant_id", "Shopify Variant ID", "shopify_selling_rate"),
              ("shopify_sku", "Shopify SKU", "shopify_variant_id")]
    for fn, label, after in fields:
        name = "Item-" + fn
        if erp.exists("Custom Field", name):
            print("custom field exists:", fn)
            continue
        print("create custom field:", fn)
        if apply:
            erp.post("/api/resource/Custom Field", {
                "dt": "Item", "fieldname": fn, "label": label, "fieldtype": "Data",
                "insert_after": after, "no_copy": 1, "search_index": 1})


def run_sync(apply=False, only=None, psv_path=None, backfill=False):
    erp = Erp()
    ensure_custom_fields(erp, apply)
    rows = psv_variants(psv_path) if psv_path else shopify_variants()
    print("Shopify variants read:", len(rows))

    ref = erp.get("/api/resource/Item/" + REFERENCE_ITEM)["data"]
    common = {k: ref.get(k) for k in ("include_item_in_manufacturing", "grant_commission",
              "default_material_request_type", "end_of_life", "weight_uom") if ref.get(k) is not None}
    common.update(item_group=ITEM_GROUP, stock_uom=UOM, is_stock_item=1, is_sales_item=1, is_purchase_item=1)
    defaults = [{"company": COMPANY, "default_warehouse": DEFAULT_WAREHOUSE}]

    # Build comprehensive lookup indexes for deduplication
    existing_items = erp.items([], ["name", "item_name", "item_code", "variant_of", "has_variants"])
    existing = {i["name"]: i for i in existing_items}
    
    # Normalized indexes for collision & de-duplication detection
    by_code_norm = {str(i.get("name") or "").strip().lower(): i["name"] for i in existing_items}
    for i in existing_items:
        if i.get("item_code"):
            by_code_norm[str(i.get("item_code")).strip().lower()] = i["name"]

    by_name_norm = {str(i.get("item_name") or "").strip().lower(): i["name"] for i in existing_items if i.get("item_name")}

    have_cf_vid = erp.exists("Custom Field", "Item-shopify_variant_id")
    have_cf_sku = erp.exists("Custom Field", "Item-shopify_sku")
    have_cf = have_cf_vid
    
    by_vid = {}
    if have_cf_vid:
        for i in erp.items([["shopify_variant_id", "is", "set"]], ["name", "shopify_variant_id"]):
            v_val = str(i.get("shopify_variant_id") or "").strip()
            if v_val:
                by_vid[v_val] = i["name"]

    # Also map items whose ERP item name / item_code IS the Shopify variant ID
    for i in existing_items:
        iname = str(i.get("name") or "").strip()
        icode = str(i.get("item_code") or "").strip()
        if iname.isdigit() and len(iname) >= 12:
            by_vid[iname] = iname
        if icode.isdigit() and len(icode) >= 12:
            by_vid[icode] = iname

    by_shopify_sku = {}
    if have_cf_sku:
        for i in erp.items([["shopify_sku", "is", "set"]], ["name", "shopify_sku"]):
            s_val = str(i.get("shopify_sku") or "").strip().lower()
            if s_val:
                by_shopify_sku[s_val] = i["name"]

    products = collections.OrderedDict()
    for r in rows:
        products.setdefault(r["pid"], []).append(r)

    stats = collections.Counter()
    plan_details = []

    for pid, vs in products.items():
        title, status = vs[0]["product"], vs[0]["status"]
        if only and title != only:
            continue
        if status in SKIP_STATUS:
            stats["skipped archived products"] += 1
            continue
        vs.sort(key=lambda r: SIZE_ORDER.get(r["size"], 9))
        blank = all(not v["sku"] for v in vs)

        def code_of(v, tcode):
            return "%s-%s" % (tcode, v["size"]) if blank else v["sku"]

        # De-duplicate template: existing template via siblings or existing lookup
        tcode = None
        for v in vs:
            hit = (
                by_vid.get(v["vid"]) or 
                by_shopify_sku.get(v["sku"].lower()) or
                by_code_norm.get(v["sku"].lower()) or
                by_name_norm.get(f"{title}-{v['size']}".lower()) or
                existing.get(v["sku"])
            )
            if hit:
                hit_name = hit if isinstance(hit, str) else hit["name"]
                if existing.get(hit_name, {}).get("variant_of"):
                    tcode = existing[hit_name]["variant_of"]
                    break
                elif existing.get(hit_name, {}).get("has_variants"):
                    tcode = hit_name
                    break

        if not tcode:
            tcode = BLANK_SKU_TEMPLATES.get(title) if blank else stem(vs[0]["sku"], vs[0]["size"])
            if not tcode:
                msg = f"!! no template code for blank-SKU product, add to BLANK_SKU_TEMPLATES: {title}"
                print(msg)
                plan_details.append(msg)
                stats["needs code"] += 1
                continue

        # Check if template already exists by code or exact item_name
        template_already_exists = (
            tcode in existing or 
            tcode.lower() in by_code_norm or 
            title.lower() in by_name_norm
        )

        desc = "<p>%s</p>" % html.escape(vs[0]["desc"]) if vs[0]["desc"] else None

        if not template_already_exists:
            line = f"TEMPLATE {tcode} <- {title}"
            print(line)
            plan_details.append(line)
            stats["templates"] += 1
            if apply:
                doc = dict(common, item_name=title, has_variants=1, variant_based_on="Item Attribute",
                           attributes=[{"attribute": SIZE_ATTR}], item_defaults=defaults)
                if vs[0]["image"]:
                    doc["image"] = vs[0]["image"]
                if desc:
                    doc["description"] = desc
                tmp = erp.post("/api/resource/Item", doc)["data"]["name"]   # auto-named by series
                erp.post("/api/method/frappe.client.rename_doc",
                         {"doctype": "Item", "old_name": tmp, "new_name": tcode, "merge": 0})
                existing[tcode] = {"name": tcode, "variant_of": None, "has_variants": 1}
                by_code_norm[tcode.lower()] = tcode
                by_name_norm[title.lower()] = tcode
        else:
            # Resolved existing template key
            if tcode not in existing:
                tcode = by_code_norm.get(tcode.lower()) or by_name_norm.get(title.lower()) or tcode

        for v in vs:
            code = code_of(v, tcode)
            var_item_name = f"{title}-{v['size']}"
            
            # --- Robust multi-factor de-duplication check ---
            duplicate_found_item = (
                by_vid.get(v["vid"]) or 
                by_shopify_sku.get(v["sku"].lower()) if v["sku"] else None or
                by_code_norm.get(code.lower()) or
                by_name_norm.get(var_item_name.lower()) or
                (code if code in existing else None)
            )

            if duplicate_found_item:
                stats["variants already present"] += 1
                if backfill and have_cf and apply:
                    matched_name = duplicate_found_item if isinstance(duplicate_found_item, str) else duplicate_found_item.get("name")
                    erp.post("/api/method/frappe.client.set_value", {
                        "doctype": "Item", "name": matched_name, "fieldname": {
                            "shopify_variant_id": v["vid"], "shopify_sku": v["sku"]}})
                continue

            if v["size"] not in SIZE_VALUE:
                msg = f"!! unknown size {v['size']} {code}"
                print(msg)
                plan_details.append(msg)
                stats["unknown size"] += 1
                continue

            line = f"  VARIANT {code} {SIZE_VALUE[v['size']]} {v['price']}"
            print(line)
            plan_details.append(line)
            stats["variants"] += 1
            if apply:
                doc = dict(common, item_code=code, item_name=var_item_name, variant_of=tcode,
                           has_variants=0, shopify_selling_rate=v["price"], shopify_variant_id=v["vid"],
                           shopify_sku=v["sku"], item_defaults=defaults,
                           attributes=[{"attribute": SIZE_ATTR, "attribute_value": SIZE_VALUE[v["size"]]}])
                if v["image"]:
                    doc["image"] = v["image"]
                if desc:
                    doc["description"] = desc
                erp.post("/api/resource/Item", doc)
                existing[code] = {"name": code, "variant_of": tcode, "has_variants": 0}
                by_code_norm[code.lower()] = code
                by_name_norm[var_item_name.lower()] = code
                by_vid[v["vid"]] = code
                if v["sku"]:
                    by_shopify_sku[v["sku"].lower()] = code

    # report leftovers: hand-made standalone items that duplicate a variant name
    leftovers = []
    print("\nLeftover hand-made items to review (never deleted by this script):")
    names = {c.lower() for c in existing}
    for i in erp.items([["name", "like", "STO-ITEM-%"], ["variant_of", "is", "not set"], ["has_variants", "=", 0]],
                       ["name", "item_name"]):
        if i["item_name"].lower() in names:
            line = f"{i['name']} {i['item_name']}"
            print("  ", line)
            leftovers.append(line)

    summary_str = f"Summary: {dict(stats)} {'(applied)' if apply else '(dry run)'}"
    print("\n" + summary_str)
    
    return {
        "stats": dict(stats),
        "is_dry_run": not apply,
        "plan_details": plan_details[:100],
        "leftovers": leftovers
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to ERPNext (default is dry run)")
    ap.add_argument("--only", help="process only the Shopify product with this title")
    ap.add_argument("--psv", help="read variants from a pipe-delimited file instead of Shopify")
    ap.add_argument("--backfill", action="store_true", help="fill Shopify ID/SKU on existing exact-match items")
    a = ap.parse_args()

    run_sync(apply=a.apply, only=a.only, psv_path=a.psv, backfill=a.backfill)


if __name__ == "__main__":
    sys.exit(main())
