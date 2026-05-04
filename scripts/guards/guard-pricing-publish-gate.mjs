#!/usr/bin/env node
/**
 * guard-pricing-publish-gate
 * Live check: no package may sit in 'queued'/'building' for >2h without
 * either a valid product_id or a heal_permanent_fix_tasks backlog entry.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.warn("⚠️  pricing-publish-gate: env missing, skipping."); process.exit(0); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: pkgs } = await sb.from("course_packages")
  .select("id, title, status, product_id, updated_at")
  .in("status", ["queued","building","blocked"]);

const { data: tasks } = await sb.from("heal_permanent_fix_tasks")
  .select("package_id").eq("pattern_key", "PRICING_NO_PRODUCT_LINK").in("status", ["open","in_progress"]);

const tracked = new Set((tasks || []).map((t) => t.package_id));
const now = Date.now();
const orphans = (pkgs || []).filter((p) => !p.product_id && !tracked.has(p.id) && (now - new Date(p.updated_at).getTime()) > 2*3600*1000);
for (const o of orphans) console.error(`❌ Pricing-orphan untracked: ${o.title} (${o.id}) status=${o.status}`);
if (orphans.length > 0) { console.error(`\n❌ guard-pricing-publish-gate: ${orphans.length} untracked orphan(s).`); process.exit(1); }
console.log(`✅ guard-pricing-publish-gate passed (${(pkgs||[]).length - tracked.size} active, ${tracked.size} tracked).`);
