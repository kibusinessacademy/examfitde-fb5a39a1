---
name: Post-Purchase Activation Cut 1d
description: Activation Nudge Dispatcher. Idempotentes Ledger activation_nudge_events (6h-Fenster pro grant+stage+nudge_type). Admin-RPCs preview+dispatch, dry_run-default, Reason-Pflicht, kein Direktversand, kein PII-Leak. UI ActivationNudgeDispatcherCard im Growth-Dashboard.
type: feature
---

# Post-Purchase Activation Cut 1d — Activation Nudge Dispatcher (2026-05-18)

## Was anders ist vs Cut 1c
- 1c **misst** stale Aktivierungen (read-only Diagnose).
- 1d **plant** kontrollierte, idempotente Nudges aus diesen Signalen — **als Vorstufe**, ohne Versand, ohne Frontend-State, ohne PII-Leak.

## Bausteine
- **Ledger `activation_nudge_events`** (admin-read, service-role-write):
  - `grant_id, user_id, package_id, stage, nudge_type, status ∈ {planned,dispatched,skipped,suppressed}`
  - `dedupe_key` UNIQUE → 6h-Bucket pro `grant_id + stage + nudge_type`
  - `blocked_reason, channel_hint='inapp', meta jsonb, created_by, planned_at, dispatched_at`
  - RLS: admin-only SELECT, service_role ALL
- **Helper SQL**:
  - `fn_classify_activation_nudge(stage, blocked_reason)` IMMUTABLE → 5 Nudge-Typen
    `welcome_not_started | first_task_missing | aha_missing | plan_missing | inactive_24h` (sonst `none`).
    `no_first_value_after_24h` schlägt jede Stage.
  - `fn_activation_nudge_dedupe_key(grant_id, stage, nudge_type, at)` IMMUTABLE → 6h-Fenster.
- **RPC `admin_preview_activation_nudges(_window_hours=48, _limit=50)`**
  - SECURITY DEFINER + `has_role(admin)` Gate
  - liest **nur** `v_activation_assurance_ssot` (SSOT) + Left-Join Ledger
  - `idempotency_state ∈ {eligible, already_planned, already_dispatched, …}`
  - PII-frei (`learner_ref = 'user_' || sha256-prefix`)
  - Audit `activation_nudge_preview_viewed` (best-effort)
- **RPC `admin_dispatch_activation_nudge(_grant_id, _reason, _dry_run=true)`**
  - admin-gated + Reason-Pflicht (min 4 Zeichen)
  - Reihenfolge:
    1. Grant-Lookup im SSOT-View
    2. `not_stale` → skip
    3. `nudge_type = 'none'` → skip (`no_applicable_nudge`)
    4. Dedupe-Lookup → skip `idempotent_duplicate` mit `existing_event_id`
    5. `dry_run=true` → `status='dry_run'` (kein Insert)
    6. sonst Insert `status='planned'` + Audit `activation_nudge_dispatched`
  - **kein** Versand, **kein** Outbox-Push — Outbox-Anbindung kommt in Cut 1e.
- **Audit-Contracts** registriert (`ops_audit_contract.owner_module='activation_cut_1d'`):
  - `activation_nudge_preview_viewed` (window_hours, total)
  - `activation_nudge_dispatched` (event_id, nudge_type, stage, dedupe_key, reason)
  - `activation_nudge_skipped` (skip_reason)
- **UI `ActivationNudgeDispatcherCard`** (Growth/Dashboard, unter Assurance-Card):
  - Window-Switch 24h/48h/7d, Refresh, Reason-Input (gated)
  - Liste: learner_ref, package, stage, nudge_type, minutes_since_grant, idempotency_state
  - Pro Zeile: `Dry-run` + `Plan` (nur bei `eligible`)
  - Toast + Query-Invalidate nach jeder Aktion
- **Helper `classifyActivationNudge` (TS)** als Spiegel der SQL-Funktion für Tests/Preview. 6 Tests grün.

## Constraints / Guardrails
- View bleibt SSOT — RPCs lesen **nur** View+Ledger, Frontend ruft **nur** RPCs (Rule 17 / ssot-guard).
- `user_id` wird gehasht (kein PII in Preview/Audit).
- Dry-run-Default + Reason-Pflicht verhindern Schnellschüsse.
- Idempotenz strukturell durch UNIQUE-Index erzwungen — kein Race möglich.
- Keine Notification, kein Channel-Send in 1d.

## Out-of-scope (→ Cut 1e/1f)
- Outbox/E-Mail/Push-Anbindung (`status: planned → dispatched`)
- Auto-Scheduler (Cron, derzeit nur manueller Trigger)
- Personalisierte Tonalität pro Persona
- Suppressed-Regeln (Quiet Hours, Frequency Cap)
