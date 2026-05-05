#!/usr/bin/env node
/**
 * Build-Integrity E2E CI Gate
 *
 * Calls admin_build_integrity_e2e via Supabase REST and fails the build if any
 * published package has data holes or missing canonical step keys.
 *
 * Threshold (env-overridable):
 *   - MAX_DATA_HOLES_PUBLISHED=0    (published packages must be hole-free)
 *   - MAX_DATA_HOLES_BUILDING=10    (in-flight packages get more slack)
 *   - HARD_FAIL_ON_MISSING_STEPS=1  (any missing canonical step on published = fail)
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_*_KEY env");
  process.exit(2);
}

const MAX_HOLES_PUBLISHED = Number(process.env.MAX_DATA_HOLES_PUBLISHED ?? 0);
const MAX_HOLES_BUILDING = Number(process.env.MAX_DATA_HOLES_BUILDING ?? 10);
const HARD_FAIL_MISSING = process.env.HARD_FAIL_ON_MISSING_STEPS !== "0";

async function main() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/admin_build_integrity_e2e`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_limit: 500 }),
    },
  );

  if (!res.ok) {
    console.error(`RPC failed: ${res.status} ${await res.text()}`);
    process.exit(2);
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) {
    console.error("Unexpected RPC payload:", rows);
    process.exit(2);
  }

  const violations = [];
  let okPublished = 0;
  let okBuilding = 0;

  for (const r of rows) {
    const isPublished = r.status === "published";
    const cap = isPublished ? MAX_HOLES_PUBLISHED : MAX_HOLES_BUILDING;
    const holes = Number(r.data_holes ?? 0);
    const missing = Array.isArray(r.missing_step_keys)
      ? r.missing_step_keys
      : [];

    const failHoles = holes > cap;
    const failMissing =
      isPublished && HARD_FAIL_MISSING && missing.length > 0;

    if (failHoles || failMissing) {
      violations.push({
        package_id: r.package_id,
        title: r.title,
        status: r.status,
        data_holes: holes,
        missing: missing.slice(0, 5),
        cap,
      });
    } else if (isPublished) okPublished++;
    else okBuilding++;
  }

  console.log(
    `Build-Integrity E2E: ${rows.length} pakete · ${okPublished} published ok · ${okBuilding} building ok · ${violations.length} violations`,
  );

  if (violations.length === 0) {
    console.log("✅ no data holes above threshold");
    process.exit(0);
  }

  console.error("❌ Build-Integrity violations:");
  for (const v of violations) {
    console.error(
      ` - [${v.status}] ${v.title} (${v.package_id.slice(0, 8)}) holes=${v.data_holes}/${v.cap} missing=${v.missing.join(",") || "—"}`,
    );
  }
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
