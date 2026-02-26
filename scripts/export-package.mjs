#!/usr/bin/env node

/**
 * Export Package Script
 * 
 * Calls the export-course-package edge function and saves the ZIP.
 * Usage: node scripts/export-package.mjs --packageId=UUID [--out=exports/latest.zip]
 */

import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const [k, ...rest] = s.replace(/^--/, "").split("=");
    return [k, rest.join("=") || true];
  })
);

const packageId = args.packageId;
const out = args.out ?? "exports/latest.zip";

if (!packageId) {
  console.error("Usage: node scripts/export-package.mjs --packageId=UUID [--out=path]");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function main() {
  console.log(`📦 Exporting package ${packageId}...`);

  const res = await fetch(`${SUPABASE_URL}/functions/v1/export-course-package`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      apikey: KEY,
    },
    body: JSON.stringify({ packageId }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Export failed: ${res.status} ${body}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(`✅ Wrote export zip: ${out} (${(buf.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
