#!/usr/bin/env node
/**
 * schema-contract-product-prices
 * Verifies live DB schema matches the contract.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key);

const REQUIRED = ["billing_type"];
const FORBIDDEN = ["billing_interval"];

const { data, error } = await supabase.rpc("get_table_columns", {
  p_schema: "public",
  p_table: "product_prices",
});
if (error) { console.error("❌ Could not read schema:", error.message); process.exit(1); }

const cols = new Set(data.map((r) => r.column_name));
let failed = false;
for (const c of REQUIRED) if (!cols.has(c)) { console.error(`❌ Missing required column public.product_prices.${c}`); failed = true; }
for (const c of FORBIDDEN) if (cols.has(c)) { console.error(`❌ Forbidden legacy column still exists: public.product_prices.${c}`); failed = true; }
if (failed) process.exit(1);
console.log("✅ schema-contract-product-prices passed");
