#!/usr/bin/env node

/**
 * Pricing Integrity Regression Guard
 *
 * Verifies the post-migration target state for pricing of published packages:
 *   - published_without_price       === 0
 *   - duplicate_product_cases       === 0
 *   - manual_review_cases           === 0
 *   - cluster: action_needed = 'none' must equal total_published_packages
 *
 * Source of truth:
 *   - public.v_pricing_integrity_check  (aggregate ampel)
 *   - public.v_pricing_backfill_dryrun  (per-package cluster counts)
 *
 * Auth:
 *   Prefers SUPABASE_SERVICE_ROLE_KEY (CI). Falls back to ANON; if the views
 *   are not exposed to anon, the script exits cleanly with a SKIP.
 *
 * Exit codes:
 *   0 — green (or skipped because no credentials available)
 *   1 — red/yellow (drift detected) or unexpected error
 *
 * Run locally:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/pricing-integrity-check.mjs
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log(
    "⚠️  SUPABASE_URL / SUPABASE_*_KEY not set — skipping pricing-integrity-check",
  );
  process.exit(0);
}

async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function isPermissionDenied(body) {
  if (!body || typeof body !== "object") return false;
  const code = body.code || body.error_code;
  const msg = (body.message || body.msg || "").toString().toLowerCase();
  return code === "42501" || msg.includes("permission denied");
}

const FAIL = (...m) => {
  console.error("❌", ...m);
};
const OK = (...m) => console.log("✅", ...m);
const INFO = (...m) => console.log("•", ...m);

async function main() {
  // 1. Aggregate ampel
  const ampel = await restGet(
    "v_pricing_integrity_check?select=*&limit=1",
  );

  if (ampel.status === 404) {
    FAIL(
      "View v_pricing_integrity_check missing — Pricing-Regression-Guard Migration nicht angewandt",
    );
    process.exit(1);
  }

  if (isPermissionDenied(ampel.body) || ampel.status === 401) {
    console.log(
      "⚠️  No permission for v_pricing_integrity_check (anon key) — skipping. Provide SUPABASE_SERVICE_ROLE_KEY in CI.",
    );
    process.exit(0);
  }

  if (ampel.status >= 400 || !Array.isArray(ampel.body)) {
    FAIL("Unexpected response from v_pricing_integrity_check:", ampel);
    process.exit(1);
  }

  const row = ampel.body[0];
  if (!row) {
    FAIL("v_pricing_integrity_check returned no rows");
    process.exit(1);
  }

  INFO(
    `Status=${row.status}  published=${row.total_published_packages}  ` +
      `without_price=${row.published_without_price}  ` +
      `duplicates=${row.duplicate_product_cases}  ` +
      `manual_review=${row.manual_review_cases}`,
  );

  let failures = 0;
  if (row.published_without_price !== 0) {
    FAIL(`published_without_price=${row.published_without_price} (expected 0)`);
    failures++;
  }
  if (row.duplicate_product_cases !== 0) {
    FAIL(`duplicate_product_cases=${row.duplicate_product_cases} (expected 0)`);
    failures++;
  }
  if (row.manual_review_cases !== 0) {
    FAIL(`manual_review_cases=${row.manual_review_cases} (expected 0)`);
    failures++;
  }

  // 2. Cluster-Zählung: action_needed='none' must equal total_published_packages
  const cluster = await restGet(
    "v_pricing_backfill_dryrun?select=action_needed",
  );
  if (Array.isArray(cluster.body)) {
    const counts = cluster.body.reduce((acc, r) => {
      acc[r.action_needed] = (acc[r.action_needed] ?? 0) + 1;
      return acc;
    }, {});
    INFO("Cluster:", JSON.stringify(counts));
    const noneCount = counts.none ?? 0;
    if (noneCount !== row.total_published_packages) {
      FAIL(
        `cluster.none=${noneCount} != total_published_packages=${row.total_published_packages}`,
      );
      failures++;
    }
    for (const k of Object.keys(counts)) {
      if (k !== "none" && counts[k] > 0) {
        FAIL(`cluster.${k}=${counts[k]} (expected 0)`);
        failures++;
      }
    }
  } else if (isPermissionDenied(cluster.body)) {
    INFO(
      "Cluster view not readable with current key — relying on aggregate only.",
    );
  }

  if (failures > 0) {
    FAIL(`Pricing integrity FAILED with ${failures} drift(s)`);
    process.exit(1);
  }

  OK("Pricing integrity GREEN — all targets met");
}

main().catch((err) => {
  FAIL("Unexpected error:", err?.message || err);
  process.exit(1);
});
