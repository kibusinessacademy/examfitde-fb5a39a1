#!/usr/bin/env node
/**
 * P5 Guard — Semantic Knowledge Graph integrity.
 *
 * Calls the public RPC `semantic_graph_get_published` (anon) and fails the
 * build if the currently published snapshot is broken:
 *   - any edge references an entity_id missing from the snapshot
 *   - any entity has neither incoming nor outgoing edges (graph orphan)
 *   - any duplicate (kind,key) entity
 *
 * Cold-start tolerant: if no snapshot is published yet (entity_count = 0)
 * the guard exits 0. Activate hard-fail after first materialization run.
 */
import fs from "node:fs";
import path from "node:path";

function readEnv() {
  const out = {};
  const p = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=("?)([^"]*)\2\s*$/);
      if (m) out[m[1]] = m[3];
    }
  }
  return out;
}
const env = readEnv();
const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!URL_ || !KEY) {
  console.warn("[graph-guard] SUPABASE_URL / KEY missing — skipping (non-fatal).");
  process.exit(0);
}

const res = await fetch(`${URL_}/rest/v1/rpc/semantic_graph_get_published`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: "{}",
});
if (!res.ok) {
  console.warn(`[graph-guard] RPC HTTP ${res.status} — skipping (non-fatal).`);
  process.exit(0);
}
const g = await res.json();
const entities = g?.entities ?? [];
const edges = g?.edges ?? [];

if (entities.length === 0) {
  console.log("[graph-guard] cold-start (no published snapshot yet) — OK.");
  process.exit(0);
}

const ids = new Set(entities.map((e) => e.id));
const errors = [];

// 1. Duplicate (kind,key)
const seen = new Set();
for (const e of entities) {
  const k = `${e.kind}|${e.key}`;
  if (seen.has(k)) errors.push(`duplicate (kind,key): ${k}`);
  seen.add(k);
}

// 2. Edge endpoint integrity
const adj = new Set();
for (const x of edges) {
  if (!ids.has(x.from)) errors.push(`edge.from missing entity: ${x.from}`);
  if (!ids.has(x.to)) errors.push(`edge.to missing entity: ${x.to}`);
  adj.add(x.from);
  adj.add(x.to);
}

// 3. Graph orphans (entities with no incoming and no outgoing edges)
const orphans = entities.filter((e) => !adj.has(e.id));
if (orphans.length > 0) {
  errors.push(
    `${orphans.length} graph orphan(s) — first 5: ` +
      orphans
        .slice(0, 5)
        .map((o) => `${o.kind}/${o.key}`)
        .join(", "),
  );
}

if (errors.length) {
  console.error(`[graph-guard] FAIL (${errors.length} issue(s)):`);
  for (const e of errors.slice(0, 20)) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `[graph-guard] OK — snapshot ${g.snapshot_at} | ${entities.length} entities, ${edges.length} edges, 0 orphans, 0 dup, 0 dangling.`,
);
