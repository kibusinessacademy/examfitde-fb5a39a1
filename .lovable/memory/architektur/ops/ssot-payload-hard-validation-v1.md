---
name: SSOT Payload Hard Validation v1.2 (+ Trigger-Reattach + DLQ + Dashboard)
description: Wurzel-Befund 2026-05-02 Late: trg_job_queue_ssot_validate war NIE auf job_queue angeheftet (CREATE TRIGGER aus v1 nicht ausgeführt) → 47/58 Inserts in 30min ohne enqueue_source/step_key. v1.2 fix attached trigger explicitly. Erweiterte Logs (violations_detail{missing_fields,auto_derived,producer_hint,critical}). DLQ job_queue_dead_letter mit RLS+admin-only. RPCs admin_get_ssot_dashboard (5 KPIs+Top-5 Producer+hard_block_in_hours), admin_ssot_producer_regression_test (fail-loud mit auto_heal_log Audit), admin_get_ssot_verification (10min snapshot), admin_get_dlq_recent. UI SSOTPayloadDashboardCard im KPIPage Quality-Tab + Regression-Button. CI .github/workflows/ssot-payload-on-deploy-check.yml (push migration + 30min cron).
type: feature
---

# SSOT Payload Hard Validation v1.2 (2026-05-02)

## Root-Cause Befund (Late)
Snapshot 30min: 47 Inserts ohne `enqueue_source`, 58 ohne `step_key`, obwohl Trigger v1.1 die Auto-Derive-Logik enthielt. Ursache: **`trg_job_queue_ssot_validate` war nie an `job_queue` angeheftet** — `CREATE TRIGGER` aus Migration v1 hat nicht durchgegriffen, nur die Function existierte. Verifikation via `pg_trigger WHERE tgname LIKE '%ssot%'` → 0 rows.

## v1.2 Fix
1. **Trigger explizit anheften** (`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` BEFORE INSERT)
2. **Erweiterte Logs** — `metadata.violations_detail`:
   - `missing_fields[]` — welche Pflichtfelder fehlten
   - `auto_derived{}` — was wurde aus job_type/meta abgeleitet
   - `producer_hint` — bester Guess aus meta/payload
   - `critical` boolean — würde im enforce-Modus blocken
3. **Dead-Letter-Queue** `public.job_queue_dead_letter` (admin RLS)
   - Speichert blockierte Inserts revisionssicher mit `violations[]` + `source` + `payload`
4. **5 Dashboard-RPCs** (alle has_role-gated):
   - `admin_get_ssot_dashboard()` — 5 KPIs + Top-5 Producer + Hard-Block-Countdown
   - `admin_ssot_producer_regression_test(p_minutes)` — Pass/Fail mit Audit
   - `admin_get_ssot_verification(p_minutes)` — Snapshot für On-Deploy-CI
   - `admin_get_dlq_recent(p_limit)` — DLQ-Inhalt
   - `admin_ssot_payload_verification(p_minutes)` — service_role Smoke
5. **CI On-Deploy-Check** `.github/workflows/ssot-payload-on-deploy-check.yml`
   - Push auf `supabase/migrations/**` → 60s wait → Verification (10min Window)
   - 30-Min-Cron als Sicherheitsnetz
   - Strict-Modus via `SSOT_STRICT=1` env

## UI
`SSOTPayloadDashboardCard` (src/components/admin/SSOTPayloadDashboardCard.tsx) im KPIPage Quality-Tab unter SSOTHealthCard. Mit Regression-Button (live).

## Hard-Block Plan
Unverändert: Ab 2026-05-09 00:00 UTC schaltet Trigger auf hard-block für `missing_curriculum_id` / `missing_package_id_payload` / `forbidden_slug_field`. DLQ fängt geblockte Inserts.

## Migrationen
- v1: `20260502095*_*.sql` (Validation+Trigger-Funktion definiert, Trigger NICHT angeheftet)
- v1.1: `20260502100*_*.sql` (Reconciler-Patch + Auto-Heal Logic)
- v1.2: `20260502101*_*.sql` (Trigger reattach + Logs + DLQ + Dashboard-RPCs + Regression-RPC)
