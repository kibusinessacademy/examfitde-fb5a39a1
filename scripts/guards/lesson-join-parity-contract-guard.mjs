#!/usr/bin/env node
/**
 * Lesson-Join-Parity Contract Guard
 *
 * Hard-fails the CI if any of the required identifiers for the parity loop
 * is renamed or removed. Protects the closed control loop:
 *   detect (fn_run_lesson_join_parity_check)
 *   → cron (lesson-join-parity-daily)
 *   → guard (parity-cron-guard-daily)
 *   → audit (heal_run_audit)
 *   → alerts (heal-alerts-15min)
 *   → cockpit (admin_get_lesson_join_parity_summary)
 *
 * Mode: greps the supabase/migrations/ folder. The latest occurrence wins,
 * so renames must add a NEW migration that recreates the symbol.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

const REQUIRED = [
  "fn_run_lesson_join_parity_check",
  "admin_get_lesson_join_parity_summary",
  "lesson-join-parity-daily",
  "fn_run_parity_cron_guard",
  "parity-cron-guard-daily",
  "fn_run_heal_alert_evaluator",
  "heal-alerts-15min",
  "admin_get_heal_run_audit_trail",
  "fn_record_heal_run_audit",
  "admin_get_heal_alerts_summary",
  "admin_update_heal_alert_config",
  "admin_get_heal_queue_audit",
  "admin_get_drift_coverage_matrix",
  "heal_alert_config",
  "heal_alert_destinations",
  "heal_alert_notifications",
  "admin_upsert_heal_alert_destination",
  "admin_delete_heal_alert_destination",
  "admin_get_heal_alert_notifications",
  "heal-alerts-dispatch-5min",
  "fn_check_notification_delivery_health",
  "admin_get_notification_delivery_health",
  "notification-delivery-health-hourly",
  "fn_simulate_parity_cron_guard",
  "fn_simulate_parity_cron_guard_outbox",
  "fn_simulate_dispatch_parity_notification",
];

if (!fs.existsSync(MIG_DIR)) {
  console.error(`[parity-contract-guard] migrations dir missing: ${MIG_DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"));
const haystack = files.map((f) => fs.readFileSync(path.join(MIG_DIR, f), "utf8")).join("\n");

const missing = REQUIRED.filter((sym) => !haystack.includes(sym));

if (missing.length) {
  console.error("❌ Lesson-Join-Parity Contract Guard FAILED");
  console.error("   Missing identifiers (likely removed/renamed):");
  for (const m of missing) console.error("    - " + m);
  console.error("\nIf intentional: add a new migration that recreates the symbol or update this guard.");
  process.exit(1);
}

console.log(`✅ Parity contract intact (${REQUIRED.length} identifiers).`);
