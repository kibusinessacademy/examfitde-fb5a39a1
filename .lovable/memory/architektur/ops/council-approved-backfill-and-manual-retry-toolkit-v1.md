---
name: Council-Approved Artifact Backfill + Manual Retry Toolkit v1
description: council_approved-Artifact via Backfill-RPC + AFTER-Step-Done-Trigger + defensiver Edge-Producer-Patch. Targeted Auto-Publish Retry RPC mit bronze_lock_override + Audit-View mit Filtern und Last-Error-Klassifizierung
type: feature
---

## Problem
4 von 9 Group-B Pakete (Bronze 78, REVIEW_REQUIRED, qc=done) hatten `course_packages.council_approved=false` — die Edge-Function `package-quality-council` setzte das Häkchen nur INSIDE des `try { markStepDone(...) }`-Blocks, sodass jeder Fehler im Step-Done-Pfad das Approval-Artifact verschluckte. Nachgelagerte auto_publish-Jobs hingen mit `PARKED_AWAITING_PRECONDITION: quality_council must produce artifacts`.

## Fix (Migration 20260512065929)

### Backfill + Producer-Hardening
- `admin_backfill_council_approved(dry_run)` — service_role + admin-Gate. Setzt `council_approved=true` + `_at` für Pakete mit `quality_council.status=done` AND `meta.score>=75` AND verdict in (PASS|REVIEW_REQUIRED|APPROVED).
- `trg_sync_council_approved_on_step_done` AFTER UPDATE OF status,meta auf `package_steps` (WHEN step_key='quality_council' AND status='done') → setzt Häkchen idempotent + Audit `council_approved_artifact_autoset`. Defensive Garantie unabhängig vom Edge-Code.
- Edge-Function `package-quality-council/index.ts`: `council_approved`-Update VOR `markStepDone(...)` verschoben; setzt zusätzlich `council_approved_at` und filtert `.eq('council_approved', false)` (idempotent). Nur wenn `score>=75 && status in (PASS|REVIEW_REQUIRED|APPROVED)`.

### Targeted Auto-Publish Retry
- `admin_retry_auto_publish_for_packages(uuid[])` — admin-gated. Setzt failed `auto_publish` Steps auf `queued` + enqueued `package_auto_publish` Jobs mit `payload.bronze_lock_override=true` + `enqueue_source='admin_targeted_retry'`. Idempotent: skipped wenn aktiver Job vorhanden. Audit `manual_targeted_auto_publish_retry`.
- UI: `AutoPublishRetryCard` mit Multi-UUID-Textarea + Auto-Rescan (poll alle 60s für 10min via `admin_get_auto_publish_retry_status`) + Toast bei neu erkanntem Block.

### Last-Error Klassifizierung
- `fn_classify_publish_last_error(text)` IMMUTABLE → TRACK_GUARD | PRICING_PRODUCT | PUBLISH_ARTIFACT | BRONZE_LOCK | PARKED_PREREQ | NOOP_LOOP | OTHER.
- `admin_get_auto_publish_retry_status(uuid[])` → returns Pkg/Step/Job + classified error_group + council_approved.

### Audit-View
- `admin_get_manual_retry_audit(action_types text[], package_id uuid, since, until, limit)` mit Special-Marker `__manual__` für Quick-Preset (alle manuellen Retry/Backfill/Unlock-Aktionen).
- UI: `ManualRetryAuditCard` mit Filter Action × Paket × Zeitfenster (1h/24h/7d).

## Baseline 2026-05-12
Backfill: 3 Pakete (Uhrmacher, Servicekaufmann LV, Agrarservice) auf `council_approved=true` gesetzt. Smoke-Tests Classifier passieren TRACK_GUARD/PRICING_PRODUCT/PARKED_PREREQ.

## Lessons Learned
- "Artifact" im quality_council-Kontext ist NICHT ein `package_artifacts`-Eintrag (Tabelle existiert nicht), sondern die boolean `course_packages.council_approved`. Die Fehlermeldung `must produce artifacts` aus `fn_retry_guard_smart_repair` ist generisch und irreführend.
- Producer-Trigger gehört IMMER auf den DB-Layer (single choke-point), Edge-Update bleibt als Performance-Optimierung erhalten.
