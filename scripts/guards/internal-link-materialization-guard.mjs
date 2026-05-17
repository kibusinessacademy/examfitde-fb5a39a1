#!/usr/bin/env node
/**
 * E3c Internal-Link-Materialization Static Guard
 * ────────────────────────────────────────────────────────────
 * Verhindert direkte Client-Mutationen auf seo_internal_link_suggestions
 * außerhalb der admin RPC. UI darf nur über
 *   admin_materialize_internal_links
 *   admin_get_internal_link_materialization_summary
 *   admin_get_internal_link_materialization_recent
 * gehen.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCAN = [join(ROOT, "src")];
const DENY = [
  /\.from\(\s*['"]seo_internal_link_suggestions['"]\s*\)\s*\.(update|delete|insert|upsert)\b/,
];
const ALLOW_FILE = /InternalLinkMaterializationCard\.tsx$/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const violations = [];
for (const root of SCAN) {
  for (const f of walk(root)) {
    if (ALLOW_FILE.test(f)) continue;
    const src = readFileSync(f, "utf8");
    for (const re of DENY) {
      if (re.test(src)) {
        violations.push(`${f}: direct mutation on seo_internal_link_suggestions`);
      }
    }
  }
}

if (violations.length) {
  console.error("E3c guard failed:\n" + violations.map((v) => "  - " + v).join("\n"));
  process.exit(1);
}
console.log("E3c internal-link-materialization guard: OK");
