---
name: Enrichment-Gate Watcher + Pattern X6 Alerting + Suggestion-Flow
description: Watcher kickt Mass-Enrich für ENRICHMENT_GATE-Pakete (cron 10min), Trigger trg_detect_status_reverter loggt building→queued/blocked als PATTERN_X6_STATUS_REVERTER mit Trigger-Liste, Cockpit-Card schlägt AUTO_PROMOTE/SKIP_TRACK_DRIFT/WAIT_GATE für queued+done>0+0 active vor.
type: feature
---

## Komponenten

### 1. Enrichment-Gate Watcher
- `fn_watch_enrichment_gates_and_kick_enrich(max, cooldown)` SECURITY DEFINER, service_role only.
- Findet `course_packages` mit `blocked_reason ILIKE 'ENRICHMENT_GATE%' | '%competencies enriched%' | '%competency_coverage%' | 'content_gap'`.
- Ruft `count_unenriched_competencies_for_curriculum(curriculum_id)`. Bei >0 + Cooldown clear → `fn_enqueue_competency_fill_for_gap_packages(1, cooldown)`.
- Cron `enrichment-gate-watcher-10min` (`*/10`).
- Logt jeden Lauf in `heal_audit_layers` (gate_layer_before/after, action_type=mass_enrich_kicked|cooldown_active|gate_resolved).

### 2. Pattern X6 Status-Reverter
- Trigger `trg_detect_status_reverter` (AFTER UPDATE OF status WHEN status changed).
- `fn_detect_status_reverter()` schreibt bei `building → queued|blocked` in `heal_audit_layers` mit:
  - `symptom_before/after`, `gate_layer_after.active_triggers` (Liste aller aktiven course_packages-Trigger als Beweis), `transition_source`.
- Zusätzlich `auto_heal_log` Eintrag `PATTERN_X6_STATUS_REVERTER`.
- View `v_status_reverter_recent` (7 Tage), RPC `admin_get_status_reverter_recent`.

### 3. Funktions-Audit
- View `v_heal_function_audit` listet alle `fn_*heal*`, `admin_*heal*`, `fn_*enqueue*`, `fn_detect_*drift*`, `fn_watch_*`, `fn_auto_*`, `admin_*nudge*`, `admin_skip_*` mit Spalten: uses_enqueue_source_tag, uses_drift_guard, calls_enqueue, has_role_gate, is_security_definer.
- RPC `admin_get_heal_function_audit` (admin/service_role).
- Findet Producer ohne `enqueue_source`-Tag → Phase-2-Hard-Block ab 2026-05-09.

### 4. Suggestion-Flow für queued+done>0+0 active
- View `v_queued_stall_candidates`, RPC `admin_get_queued_stall_candidates`.
- `admin_suggest_heal_for_queued_stall(uuid)` Decision-Tree:
  - active>0 → WAIT (unsafe)
  - ENRICHMENT_GATE oder unenriched>0 → WAIT_GATE (safe, triggert Watcher)
  - phantom track-drift steps>0 → SKIP_TRACK_DRIFT (safe)
  - queued + done>0 + open>0 → AUTO_PROMOTE (safe, ruft admin_heal_pending_enqueue_drift)
- `admin_apply_suggested_heal(uuid)` führt sicher aus, loggt in heal_audit_layers.

### 5. UI
- Cards in HealCockpitPage Sektion 3 "Pakete heilen":
  - QueuedStallSuggestionCard (Decision + sichere Heal-Aktion)
  - StatusReverterAlertsCard (X6-Vorfälle mit Trigger-Beweisen)
  - HealFunctionAuditCard (Compliance-Tabelle)

## Security
- Alle neuen Views REVOKE FROM PUBLIC,anon,authenticated; nur service_role. Frontend-Zugriff ausschließlich via `has_role`-gegateter SECURITY DEFINER RPC.
