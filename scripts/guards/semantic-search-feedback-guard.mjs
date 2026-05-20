#!/usr/bin/env node
/**
 * P7 Guard — Semantic Search Feedback Contract.
 *
 * Ensures Search Feedback remains a measurement/diagnostics layer:
 * - no direct client reads on semantic_route_search_metrics
 * - no direct client reads on v_semantic_route_search_health
 * - no GSC/API secrets committed
 * - no raw query dumps in fixtures/code
 * - no automatic content mutation tied to search metrics
 * - import contract limited to /wissen/* routes
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INCLUDE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".sql", ".md"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo"]);
const ALLOW_SQL = new Set([
  "supabase/migrations/20260520104500_p7_semantic_search_feedback.sql",
]);
const ALLOW_FILES = new Set([
  "scripts/guards/semantic-search-feedback-guard.mjs",
  "src/lib/semantic/searchFeedback.ts",
  "src/__tests__/semantic-search-feedback.golden.test.ts",
  ".lovable/memory/architektur/semantic/search-feedback-p7-v1.md",
  ".lovable/memory/index.md",
]);

function rel(p) {
  return path.relative(ROOT, p).replaceAll(path.sep, "/");
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (INCLUDE_EXT.has(path.extname(ent.name))) out.push(p);
  }
  return out;
}

const errors = [];
for (const file of walk(ROOT)) {
  const r = rel(file);
  const text = fs.readFileSync(file, "utf8");

  const mentionsMetrics = /semantic_route_search_metrics/.test(text);
  const mentionsHealthView = /v_semantic_route_search_health/.test(text);
  const mentionsRpc = /admin_semantic_search_health|admin_semantic_route_search_detail|admin_import_semantic_search_metrics/.test(text);

  if (mentionsMetrics && !ALLOW_SQL.has(r) && !ALLOW_FILES.has(r)) {
    errors.push(`direct_search_metric_read:${r}`);
  }
  if (mentionsHealthView && !ALLOW_SQL.has(r) && !ALLOW_FILES.has(r)) {
    errors.push(`direct_search_health_view_read:${r}`);
  }

  if ((mentionsMetrics || mentionsHealthView) && r.startsWith("src/") && !mentionsRpc && !ALLOW_FILES.has(r)) {
    errors.push(`direct_search_metric_read:${r}`);
  }

  if (/GSC_(SECRET|TOKEN|API_KEY)|SEARCH_CONSOLE_(SECRET|TOKEN|API_KEY)|GOOGLE_SEARCH_CONSOLE_(SECRET|TOKEN|API_KEY)/.test(text)) {
    errors.push(`secret_leak_risk:${r}`);
  }

  if (/raw_queries\s*[:=]|raw_query\s*[:=]|gsc_query\s*[:=]/i.test(text) && !ALLOW_FILES.has(r) && !ALLOW_SQL.has(r)) {
    errors.push(`raw_query_dump_detected:${r}`);
  }

  if (/admin_import_semantic_search_metrics/.test(text) && !/\/wissen\//.test(text) && !ALLOW_SQL.has(r)) {
    errors.push(`invalid_route_import_contract:${r}`);
  }

  if (/semantic_route_search_metrics|admin_semantic_search_health|admin_import_semantic_search_metrics/.test(text)) {
    if (/update\(\{[^}]*title|update\(\{[^}]*meta|seo_content_pages|blog_articles|content_md|sections_json/.test(text) && !ALLOW_SQL.has(r)) {
      errors.push(`auto_content_mutation_detected:${r}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`[semantic-search-feedback-guard] FAIL (${errors.length} issue(s)):`);
  for (const e of errors.slice(0, 50)) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("[semantic-search-feedback-guard] OK — RPC-only search feedback, no query dumps, no content mutation.");
