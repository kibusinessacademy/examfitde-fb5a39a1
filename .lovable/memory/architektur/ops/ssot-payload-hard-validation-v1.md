---
name: SSOT Payload Hard Validation v1 (+ Producer Hardening)
description: Tail-Audit deckte 615 completed exam_pool Jobs ohne package_id, 2766 ohne step_key, 3982 ohne enqueue_source in 24h auf. assert_job_payload erweitert um package_id+step_key. BEFORE INSERT Trigger trg_job_queue_ssot_validate als Single-Chokepoint (warn bis 2026-05-09, danach hard-block). fn_atomic_enqueue_on_step_queued + fn_reconcile_orphan_steps + reconcile_queued_steps_to_jobs schreiben jetzt step_key+enqueue_source in payload. fn_heal_assert_payload als fail-loud RPC für Heal-Pfade. View v_ssot_payload_violations + admin_get RPC. Trigger v1.1 (2026-05-02): Auto-Heal package_id-Column aus payload + Auto-Derive enqueue_source aus meta/default 'unknown_producer'.
type: feature
---

# SSOT Payload Hard Validation v1 (2026-05-02)

## Audit-Findings (24h Snapshot)
- **615** completed `package_generate_exam_pool` ohne `package_id` im payload
- **2766** Tail-Jobs ohne `step_key`
- **3982** Jobs ohne `enqueue_source` (warn-only seit 5 Tagen)
- `assert_job_payload` validierte nur `curriculum_id` — Lücke
- ~40 Funktionen INSERTen direkt in `job_queue` und umgehen den enqueue-Guard

## Root Causes
1. **`fn_atomic_enqueue_on_step_queued`** schrieb `step_key` nicht in payload (nur in meta) — gefixt
2. **`fn_reconcile_orphan_steps`** schrieb weder `step_key` noch `enqueue_source` in payload — gefixt
3. **`reconcile_queued_steps_to_jobs`** Hauptproducer ohne package_id-Column, ohne step_key, ohne enqueue_source — gefixt v1.1
4. Direct-INSERT Producer (heal-RPCs, workers) hatten keine zentrale Validierung

## Fix v1 (5 Schichten)
1. **`assert_job_payload(jsonb)`** erweitert: `package_id` + `step_key` Pflicht für `package_*`-Jobs
2. **`trg_job_queue_ssot_validate` BEFORE INSERT** auf `job_queue`:
   - Phase 1 (warn-only) bis 2026-05-09 → `auto_heal_log` action `ssot_payload_warn`
   - Phase 2 (hard-block) ab 2026-05-09 → `RAISE EXCEPTION` bei kritischen Violations
   - Auto-derive `step_key` aus `job_type` falls fehlend (mit Audit)
3. **`fn_atomic_enqueue_on_step_queued`** patched: `step_key` in payload + fail-loud bei NULL `curriculum_id`
4. **`fn_reconcile_orphan_steps`** patched: `step_key` + `enqueue_source='orphan_reconciler'` in payload
5. **`fn_heal_assert_payload(...)`** SECURITY DEFINER RPC: fail-loud Helper für Heal-Code-Pfade

## Fix v1.1 (2026-05-02) — Producer Hardening
6. **`reconcile_queued_steps_to_jobs`** SSOT-konform: füllt `package_id`-Column + payload (`package_id`, `curriculum_id`, `course_id`, `certification_id`, `step_key`, `enqueue_source='reconcile_queued_steps_to_jobs'`) + meta. Fail-loud audit wenn `curriculum_id` fehlt.
7. **`fn_job_queue_ssot_validate` v1.1**:
   - **Auto-Heal `package_id`-Column** aus `payload->>'package_id'` (häufige Lücke bei direct-INSERT)
   - **Auto-Derive `enqueue_source`** aus `meta->>'enqueue_source'` → `meta->>'source'` → Default `'unknown_producer'` mit Audit
   - **Mirror enqueue_source** zwischen meta und payload
   - Hard-Block-Liste: `missing_curriculum_id`, `missing_package_id_payload`, `forbidden_slug_field`

## Forensik
- View `v_ssot_payload_violations` (service_role only)
- RPC `admin_get_ssot_payload_violations(p_hours int)` (admin-only)
- Audit-Actions: `tail_orchestration_audit_v1`, `ssot_producer_hardening_v1`

## Verifikation v1.1
- Vor Patch (60min Window): 25× `package_generate_exam_pool` ohne package_id-payload + step_key + enqueue_source
- Nach Patch (5min Window): 0 Violations bei allen 4 Pflichtfeldern

## Verboten
- Direct INSERT INTO job_queue ohne `package_id` Column + payload `package_id` für `package_*`-Jobs
- Heal-RPCs ohne `fn_heal_assert_payload(...)` Aufruf vor enqueue
- Stille Exception-Schlucker in Producer-Code
- Producer ohne expliziten `enqueue_source` Eintrag in payload ODER meta

## Hard-Block Plan
Ab 2026-05-09 schaltet `trg_job_queue_ssot_validate` automatisch auf hard-block für kritische Violations. Nicht-kritische (auto_derived_step_key, auto_filled_package_id_column, auto_derived_enqueue_source, mirrored_enqueue_source_to_payload) bleiben repair-on-write.

## Migrationen
- `supabase/migrations/20260502095*_*.sql` — Validation + Trigger v1 + Reconciler-Patch
- `supabase/migrations/20260502100*_*.sql` — Producer Hardening v1.1 (reconcile_queued_steps_to_jobs + Trigger Auto-Heal)
