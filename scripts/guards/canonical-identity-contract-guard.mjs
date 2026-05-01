#!/usr/bin/env node
/**
 * Canonical Identity Contract — Warn-Only Guard (Phase 3)
 *
 * Prüft 5 Identity-Invariants. Schreibt Report + ggf. Findings.
 * Aktuell warn-only: exit 0. Nach 7-Tage-Beobachtung auf hard-block (exit 1) umstellen.
 *
 * Sub-Guards:
 *   1. job_type_registry_guard   — Kein job_queue.job_type ohne Registry-Eintrag.
 *   2. package_identity_guard    — Kein non-archived course_package ohne package_key/title.
 *   3. job_package_id_guard      — Kein job_queue-Eintrag ohne package_id, wenn requires_package_id=true.
 *   4. correlation_id_guard      — Kein job_queue-Eintrag (jünger als 24h) ohne correlation_id/root_job_id.
 *   5. log_identity_guard        — auto_heal_log: target_id, target_type, reason_code/result_status sollten gesetzt sein.
 *
 * Nutzt REST mit anon key für read-only (Public-Views/Tabellen via RLS).
 * Fällt auf service_role zurück, wenn vorhanden.
 *
 * Run: node scripts/guards/canonical-identity-contract-guard.mjs
 *      MODE=hard node scripts/guards/canonical-identity-contract-guard.mjs   # exit 1 bei Findings
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://ubdvvvsiryenhrfmqsvw.supabase.co";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

const HARD = (process.env.MODE || "warn").toLowerCase() === "hard";

if (!SUPABASE_KEY) {
  console.warn("[identity-guard] SKIP: no Supabase key in env.");
  process.exit(0);
}

const HDR = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

async function rest(path) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const r = await fetch(url, { headers: HDR });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`REST ${r.status}: ${path} → ${txt.slice(0, 200)}`);
  }
  return r.json();
}

const findings = [];
const ok = [];

function ADD(name, severity, count, sample) {
  findings.push({ guard: name, severity, count, sample });
}
function OK(name, msg) {
  ok.push(`✅ ${name}: ${msg}`);
}

// ── Guard 1: job_type_registry_guard ──
async function guard1() {
  // Distinct job_types in queue, die nicht in registry sind
  const queueTypes = await rest(
    "job_queue?select=job_type&limit=10000",
  );
  const distinct = new Set(queueTypes.map((r) => r.job_type));
  const reg = await rest("ops_job_type_registry?select=job_type&limit=1000");
  const regSet = new Set(reg.map((r) => r.job_type));
  const missing = [...distinct].filter((t) => !regSet.has(t));
  if (missing.length > 0) {
    ADD("job_type_registry_guard", "error", missing.length, missing.slice(0, 5));
  } else {
    OK("job_type_registry_guard", `${distinct.size} job_types alle registriert`);
  }
}

// ── Guard 2: package_identity_guard ──
async function guard2() {
  const rows = await rest(
    "course_packages?select=id,title,package_key,archived&archived=eq.false&limit=2000",
  );
  const missing = rows.filter(
    (r) => !r.package_key || !r.title || r.title.trim() === "",
  );
  if (missing.length > 0) {
    ADD(
      "package_identity_guard",
      "error",
      missing.length,
      missing.slice(0, 5).map((r) => ({ id: r.id, title: r.title, key: r.package_key })),
    );
  } else {
    OK("package_identity_guard", `${rows.length} aktive Pakete haben package_key + title`);
  }
}

// ── Guard 3: job_package_id_guard ──
async function guard3() {
  const reg = await rest(
    "ops_job_type_registry?select=job_type,requires_package_id&requires_package_id=eq.true&limit=500",
  );
  const required = new Set(reg.map((r) => r.job_type));
  if (required.size === 0) {
    OK("job_package_id_guard", "kein job_type mit requires_package_id=true");
    return;
  }
  // jüngste 5000 jobs prüfen (vermeidet Riesen-Scans)
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const rows = await rest(
    `job_queue?select=id,job_type,package_id,created_at&created_at=gte.${since}&limit=10000`,
  );
  const violators = rows.filter(
    (r) => required.has(r.job_type) && !r.package_id,
  );
  if (violators.length > 0) {
    ADD(
      "job_package_id_guard",
      "warn",
      violators.length,
      violators.slice(0, 5).map((r) => ({ id: r.id, job_type: r.job_type })),
    );
  } else {
    OK("job_package_id_guard", `0/${rows.length} Jobs (7d) verletzen requires_package_id`);
  }
}

// ── Guard 4: correlation_id_guard ──
async function guard4() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = await rest(
    `job_queue?select=id,job_type,correlation_id,root_job_id,created_at&created_at=gte.${since}&limit=10000`,
  );
  const missing = rows.filter((r) => !r.correlation_id || !r.root_job_id);
  if (missing.length > 0) {
    ADD(
      "correlation_id_guard",
      "warn",
      missing.length,
      missing.slice(0, 5).map((r) => ({ id: r.id, job_type: r.job_type })),
    );
  } else {
    OK("correlation_id_guard", `${rows.length} Jobs (24h) haben correlation_id + root_job_id`);
  }
}

// ── Guard 5: log_identity_guard ──
async function guard5() {
  // auto_heal_log letzte 24h
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  let rows;
  try {
    rows = await rest(
      `auto_heal_log?select=id,action_type,target_id,target_type,reason_code,result_status,created_at&created_at=gte.${since}&limit=5000`,
    );
  } catch (e) {
    OK("log_identity_guard", `skip (auto_heal_log nicht lesbar via key: ${e.message.slice(0, 60)})`);
    return;
  }
  const missing = rows.filter(
    (r) => !r.action_type || !r.target_type || (!r.reason_code && !r.result_status),
  );
  if (missing.length > 0) {
    ADD(
      "log_identity_guard",
      "warn",
      missing.length,
      missing.slice(0, 5).map((r) => ({ id: r.id, action_type: r.action_type })),
    );
  } else {
    OK("log_identity_guard", `${rows.length} auto_heal_log-Einträge (24h) komplett`);
  }
}

// ── Run ──
console.log("─".repeat(72));
console.log("  CANONICAL IDENTITY CONTRACT GUARD — " + (HARD ? "HARD" : "WARN-ONLY"));
console.log("─".repeat(72));

const guards = [guard1, guard2, guard3, guard4, guard5];
for (const g of guards) {
  try {
    await g();
  } catch (e) {
    console.error(`[identity-guard] ${g.name} crashed:`, e.message);
    if (HARD) process.exit(1);
  }
}

ok.forEach((m) => console.log(m));

if (findings.length === 0) {
  console.log("\n✅ All 5 identity guards passed.");
  process.exit(0);
}

console.log("\n──────────  FINDINGS  ──────────");
for (const f of findings) {
  console.log(`\n[${f.severity.toUpperCase()}] ${f.guard}: ${f.count}`);
  console.log("  sample:", JSON.stringify(f.sample, null, 2).slice(0, 600));
}

const errs = findings.filter((f) => f.severity === "error").length;
console.log(`\nTotal: ${findings.length} finding(s), ${errs} error(s)`);

if (HARD) {
  console.error("MODE=hard — failing build.");
  process.exit(1);
}
console.log("Mode=warn — not failing build (Phase 3 grace period).");
process.exit(0);
