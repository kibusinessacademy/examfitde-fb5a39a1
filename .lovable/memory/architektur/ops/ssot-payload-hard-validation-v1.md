---
name: SSOT Payload Hard Validation v1
description: Tail-Audit deckte 615 completed exam_pool Jobs ohne package_id, 2766 ohne step_key, 3982 ohne enqueue_source in 24h auf. assert_job_payload erweitert um package_id+step_key. BEFORE INSERT Trigger trg_job_queue_ssot_validate als Single-Chokepoint (warn bis 2026-05-09, danach hard-block). fn_atomic_enqueue_on_step_queued + fn_reconcile_orphan_steps schreiben jetzt step_key+enqueue_source in payload. fn_heal_assert_payload als fail-loud RPC für Heal-Pfade. View v_ssot_payload_violations + admin_get RPC.
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
1. **`fn_atomic_enqueue_on_step_queued`** schrieb `step_key` nicht in payload (nur in meta)
2. **`fn_reconcile_orphan_steps`** schrieb weder `step_key` noch `enqueue_source` in payload
3. Direct-INSERT Producer (heal-RPCs, workers) hatten keine zentrale Validierung

## Fix (5 Schichten)
1. **`assert_job_payload(jsonb)`** erweitert: `package_id` + `step_key` Pflicht für `package_*`-Jobs
2. **`trg_job_queue_ssot_validate` BEFORE INSERT** auf `job_queue`:
   - Phase 1 (warn-only) bis 2026-05-09 → `auto_heal_log` action `ssot_payload_warn`
   - Phase 2 (hard-block) ab 2026-05-09 → `RAISE EXCEPTION` bei kritischen Violations
   - Auto-derive `step_key` aus `job_type` falls fehlend (mit Audit)
3. **`fn_atomic_enqueue_on_step_queued`** patched: `step_key` in payload + fail-loud bei NULL `curriculum_id`
4. **`fn_reconcile_orphan_steps`** patched: `step_key` + `enqueue_source='orphan_reconciler'` in payload
5. **`fn_heal_assert_payload(...)`** SECURITY DEFINER RPC: fail-loud Helper für Heal-Code-Pfade — keine still verschwindenden Exceptions mehr

## Forensik
- View `v_ssot_payload_violations` (service_role only)
- RPC `admin_get_ssot_payload_violations(p_hours int)` (admin-only)
- Audit-Action: `tail_orchestration_audit_v1`

## Verifikation
- Initial: 627 completed Jobs in 6h vs. 0 completed/6h vor Audit-Start
- Reconciler-Output nach Patch: payload enthält step_key + enqueue_source

## Verboten
- Direct INSERT INTO job_queue ohne `package_id` Column + payload `package_id` für `package_*`-Jobs
- Heal-RPCs ohne `fn_heal_assert_payload(...)` Aufruf vor enqueue
- Stille Exception-Schlucker in Producer-Code

## Hard-Block Plan
Ab 2026-05-09 schaltet `trg_job_queue_ssot_validate` und `enqueue_job_if_absent` automatisch auf hard-block. Vorher müssen alle ~40 direct-INSERT Funktionen migriert werden auf `enqueue_job_if_absent` ODER selbst step_key + enqueue_source schreiben.

## Migrationen
- `supabase/migrations/20260502095*_*.sql` — Validation + Trigger + Reconciler-Patch
