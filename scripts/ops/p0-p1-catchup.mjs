#!/usr/bin/env node
/**
 * P0 + P1 Catchup Runner
 * ----------------------
 * Wartet auf Wiederherstellung der DB-Query-Layer und führt dann
 * in strikter Reihenfolge aus:
 *
 *   P0.1  admin_backfill_pillar_source_package_id(dry_run=true)   "Phase A Backfill 19 Orphans — dry-run"
 *   P0.2  admin_backfill_pillar_source_package_id(dry_run=false)  "Phase A Backfill 19 Orphans — live"
 *         (nur wenn dry-run plausible Orphan-Anzahl meldet)
 *   P0.3  Verify  v_pillar_orphans count + auto_heal_log Audit
 *   P1    Live-Recon (published / catalog / pillars / products / store)
 *
 * Idempotent: Live-Run wird über auto_heal_log dedupliziert (24h Fenster).
 *
 * Usage:
 *   node scripts/ops/p0-p1-catchup.mjs
 *   POLL_MAX_MIN=30 node scripts/ops/p0-p1-catchup.mjs
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ── env laden ────────────────────────────────────────────
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SRK_E2E ||
  process.env.SR_KEY;

if (!URL || !KEY) {
  console.error("FATAL: SUPABASE_URL or SERVICE_ROLE_KEY missing");
  process.exit(1);
}

const POLL_MAX_MIN = Number(process.env.POLL_MAX_MIN || 30);
const POLL_INTERVAL_S = Number(process.env.POLL_INTERVAL_S || 20);
const REPORT_PATH = resolve("/mnt/documents/p0-p1-catchup-report.json");
mkdirSync(dirname(REPORT_PATH), { recursive: true });

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", D = "\x1b[2m", B = "\x1b[1m", X = "\x1b[0m";
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

async function rpc(fn, body = {}) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${fn} → ${r.status}: ${txt.slice(0, 400)}`);
  return txt ? JSON.parse(txt) : null;
}

async function rest(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`REST ${path} → ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

async function countExact(table, qs = "") {
  const r = await fetch(`${URL}/rest/v1/${table}?select=*${qs}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!r.ok) throw new Error(`count ${table} → ${r.status}`);
  const cr = r.headers.get("content-range") || "";
  const total = Number(cr.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

// ── Phase 0: warten bis DB wieder antwortet ──────────────
async function waitForDb() {
  log(`${B}Phase 0:${X} Warte auf DB-Query-Layer (max ${POLL_MAX_MIN} min, every ${POLL_INTERVAL_S}s)`);
  const deadline = Date.now() + POLL_MAX_MIN * 60_000;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      // Leichtgewichtige Probe: irgendeine RPC oder REST GET
      const r = await fetch(`${URL}/rest/v1/course_packages?select=id&limit=1`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      });
      if (r.ok) {
        log(`${G}DB online${X} (HTTP ${r.status})`);
        return true;
      }
      lastErr = `HTTP ${r.status}`;
    } catch (e) {
      lastErr = e.message;
    }
    log(`${Y}DB noch nicht ready${X} (${lastErr}) — retry in ${POLL_INTERVAL_S}s`);
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_S * 1000));
  }
  throw new Error(`DB nicht ready nach ${POLL_MAX_MIN} min — letzter Fehler: ${lastErr}`);
}

// ── Idempotenz: bereits live gelaufen? ────────────────────
async function liveAlreadyDone() {
  try {
    const rows = await rest(
      `auto_heal_log?select=id,reason,created_at` +
        `&action_type=eq.pillar_source_package_id_backfill` +
        `&reason=ilike.*live*` +
        `&created_at=gte.${new Date(Date.now() - 24 * 3600 * 1000).toISOString()}` +
        `&order=created_at.desc&limit=1`,
    );
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────
const report = {
  started_at: new Date().toISOString(),
  steps: {},
  finished_at: null,
  status: "running",
};

try {
  await waitForDb();

  // P0.1 dry-run
  log(`${B}P0.1${X} admin_backfill_pillar_source_package_id (dry-run)`);
  const dry = await rpc("admin_backfill_pillar_source_package_id", {
    _dry_run: true,
    _reason: "Phase A Backfill 19 Orphans — dry-run",
  });
  report.steps.p0_dry = dry;
  log(`  → ${JSON.stringify(dry).slice(0, 200)}`);

  // Heuristik für Live-Run: dry meldet > 0 (egal ob 19 oder weniger)
  const dryCount =
    (Array.isArray(dry) ? dry[0]?.affected ?? dry[0]?.count ?? dry.length : null) ??
    dry?.affected ??
    dry?.count ??
    null;

  // P0.2 live (skip wenn schon vorhanden in 24h)
  const already = await liveAlreadyDone();
  if (already) {
    log(`${Y}P0.2 SKIP${X} — Live-Run existiert bereits in auto_heal_log: ${already.created_at}`);
    report.steps.p0_live = { skipped: true, existing_audit: already };
  } else {
    log(`${B}P0.2${X} admin_backfill_pillar_source_package_id (live)`);
    const live = await rpc("admin_backfill_pillar_source_package_id", {
      _dry_run: false,
      _reason: "Phase A Backfill 19 Orphans — live",
    });
    report.steps.p0_live = live;
    log(`  → ${JSON.stringify(live).slice(0, 200)}`);
  }

  // P0.3 verify
  log(`${B}P0.3${X} Verify v_pillar_orphans + auto_heal_log`);
  const orphans = await countExact("v_pillar_orphans");
  const audit = await rest(
    "auto_heal_log?select=id,action_type,reason,created_at,result_status" +
      "&action_type=eq.pillar_source_package_id_backfill" +
      "&order=created_at.desc&limit=5",
  );
  report.steps.verify = { v_pillar_orphans_count: orphans, recent_audit: audit };
  log(`  v_pillar_orphans = ${orphans}`);

  // P1 Live-Recon
  log(`${B}P1${X} Live-Recon`);
  const [published, catalog_active, pillars_pub, products_active, store_active] =
    await Promise.all([
      countExact("course_packages", "&status=eq.published"),
      countExact("certification_catalog", "&is_active=eq.true"),
      countExact(
        "blog_articles",
        "&article_type=eq.pillar_guide&is_published=eq.true",
      ),
      countExact("products", "&is_active=eq.true"),
      countExact("store_products", "&is_active=eq.true"),
    ]);
  report.steps.p1_recon = {
    published,
    catalog_active,
    pillars_pub,
    products_active,
    store_active,
  };
  log(
    `  published=${published} catalog=${catalog_active} pillars=${pillars_pub} products=${products_active} store=${store_active}`,
  );

  report.status = "ok";
} catch (e) {
  report.status = "error";
  report.error = e.message;
  log(`${R}FAILED:${X} ${e.message}`);
} finally {
  report.finished_at = new Date().toISOString();
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  log(`Report → ${REPORT_PATH}`);
  console.log("\n" + JSON.stringify(report, null, 2));
}

process.exit(report.status === "ok" ? 0 : 1);
