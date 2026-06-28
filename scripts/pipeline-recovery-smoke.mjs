#!/usr/bin/env node
/**
 * PIPELINE.RECOVERY.OS.1 — Dry-run smoke
 * Invokes pipeline-recovery-plan and writes a markdown report.
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY env vars.");
  process.exit(2);
}

const url = `${SUPABASE_URL}/functions/v1/pipeline-recovery-plan`;
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ dry_run: true }),
});
const json = await res.json();
const lines = [
  `# pipeline-recovery smoke (${new Date().toISOString()})`,
  ``,
  `HTTP ${res.status}`,
  ``,
  "```json",
  JSON.stringify(json, null, 2).slice(0, 8000),
  "```",
];
const fs = await import("node:fs");
fs.writeFileSync("/tmp/pipeline-recovery-report.md", lines.join("\n"));
console.log(`wrote /tmp/pipeline-recovery-report.md (status=${res.status})`);
