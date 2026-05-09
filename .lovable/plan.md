## Scope (4 Tracks, eine Migration je Concern)

### Track A — Gate-Decision History & Audit
**Ziel:** Jede Entscheidung pro Paket inkl. Input-Snapshot nachvollziehbar.

- **Tabelle** `quality_gate_decision_history`
  - `id, package_id, decision, prev_decision, quality_score, quality_badge, bronze_locked, report_status, rules_failed, rules_warned, report_signal`
  - `inputs jsonb` (pending_default_pool, failure_rate_15m, reaper_churn_5m, lane, pool, gate_health snapshot)
  - `recorded_at, recorded_by (system|admin uid|cron)`
- **RPC** `fn_snapshot_quality_gate_decisions()` (service_role): vergleicht aktuellen `v_quality_gate_decision_per_pkg` mit letztem Eintrag pro Paket, schreibt nur bei Decision-Wechsel + tagged Input-Snapshot via `fn_worker_health_gate()` + Job-Queue-Recon.
- **Cron** alle 10 Min + on-demand `admin_record_gate_decisions_now()` (admin-gated).
- **RPC** `admin_get_gate_decision_history(p_package_id, p_limit)` (admin has_role).
- **UI** `QualityGateDecisionsCard`: Drill-Down-Drawer per Zeile zeigt Verlauf + Inputs.

### Track B — S2 Mastery v2 (Hauptlieferung)
**Ziel:** SSOT für Lernfortschritt + Next-Best-Step-Engine.

#### Schema
- `learner_competency_state` (PK `(user_id, course_id, competency_id)`)
  - `mastery_score numeric(5,2)` 0–100 (EWMA gewichtete Korrektheit)
  - `confidence numeric(5,2)` 0–100 (sample-size-gewichtete Sicherheit)
  - `decay_score numeric(5,2)` 0–100 (Time-decay seit `last_practice_at`)
  - `exam_readiness numeric(5,2)` 0–100 (mastery × confidence × (1 − decay-penalty) × syllabus_weight)
  - `error_pattern jsonb` (`{misconception_tags:[], recurring_question_ids:[], avg_response_ms, hint_usage_rate}`)
  - `samples_total, samples_correct, last_practice_at, last_event_type, updated_at`
- `learner_mastery_event_log` (audit jeder Update-Quelle: minicheck/quiz/exam/tutor)
- RLS: User sieht nur eigene Zeilen; Service-Role full-write.

#### Updates
- **RPC** `update_mastery_from_attempt(p_user_id, p_course_id, p_competency_id, p_correct, p_response_ms, p_event_type, p_question_id, p_misconception_tags)`
  - EWMA mit α=0.30
  - Decay: `decay_score = 100 * exp(-days_since_last_practice / 14)`
  - Confidence: `100 * (1 − exp(-samples_total/8))`
  - `exam_readiness = mastery × (confidence/100) × (decay_score/100)`
  - Audit-Insert in `learner_mastery_event_log`
  - SECURITY DEFINER, validate `auth.uid() = p_user_id` ODER service_role.

#### Next-Best-Step-Engine
- **RPC** `learner_next_best_step(p_user_id, p_course_id)` returns ranked list (top 5)
  - Score = `(100 - exam_readiness) × syllabus_weight × urgency_factor(exam_date)`
  - Type-Priorisierung: REPAIR (mastery<60) → DRILL (60-79) → REINFORCE (80-89) → CHALLENGE (≥90)
  - Decay-Boost wenn `decay_score < 50`
  - Returns: `competency_id, recommended_action, exam_readiness, reason, payload`

#### View
- `v_learner_mastery_summary` per (user, course): avg_readiness, weakest_3, strongest_3, decay_alerts, last_active_at.

### Track C — Burst-v2 Tests
- Bestehende Truth-Table erweitern um:
  - failure_rate-Tiers (0.10/0.20)
  - reaper_churn-Tiers (5/10)
  - Kombinatorik failure × lane (control+failure)
  - Pool != default
  - Boundary clamp 5..100
- Integrations-Test (vitest mit live RPC): 12 cases gesamt.

### Track D — Auto-Pulse Verification
- **View** `v_auto_recovery_pulse_cron_health` aus `auto_heal_log` (last 24h):
  - Anzahl Decisions pro Pfad (pulsed/noop_*), p50/p95 burst_size, p50 oldest_min, Anzahl pulsed_jobs
- **RPC** `admin_get_auto_recovery_pulse_health()` (admin-gated)
- **RPC** `admin_smoke_auto_recovery_pulse()` simuliert Decision (ohne Side-Effect via DRY-RUN-Flag in fn) — fügt Pfad zum bestehenden `fn_auto_recovery_pulse_decide` hinzu via Wrapper `fn_auto_recovery_pulse_decide_dryrun()`.
- **UI** Sektion in `RecoveryPulseHistoryCard`: Health-Strip oben (last 6h decisions distribution).
- **Vitest**: 4 Cases (refusal, dryrun shape, history rpc, decision constants present in last 24h).

## Migrations-Plan (sequenziell, je 1 Concern)

| # | Concern |
|---|---------|
| 1 | Track A: Tabelle + Snapshot-RPC + Cron + Admin-RPC |
| 2 | Track B Schema: `learner_competency_state` + `learner_mastery_event_log` + RLS + Indizes |
| 3 | Track B Logic: `update_mastery_from_attempt` + `v_learner_mastery_summary` |
| 4 | Track B Engine: `learner_next_best_step` + Helper |
| 5 | Track D: `fn_auto_recovery_pulse_decide_dryrun` + Health-View + Admin-RPC |

## Code-Änderungen (UI/Tests)

| Datei | Zweck |
|---|---|
| `src/components/admin/heal/cards/QualityGateDecisionsCard.tsx` | Drill-Down-Drawer für History |
| `src/components/admin/heal/cards/RecoveryPulseHistoryCard.tsx` | Health-Strip oben |
| `src/test/ops/dag-heal-and-alerts.test.ts` | Burst-v2 erweiterte Truth-Table + Auto-Pulse-Verifikation |
| `src/test/learner/mastery-v2.test.ts` | Mastery-Update + next_best_step Smoke (anon refusal + service-role contract) |

## Memory & Audit
- Neue Memory-Files: `s2-mastery-v2-foundation`, `gate-decision-history-v1`, `auto-pulse-verification-v1`
- Index-Update mit 3 neuen Memories
- `auto_heal_log` Audit pro Migration mit Rollback-Hint

## Out-of-Scope (Folge-Sprints)
- Mastery-Trigger-Verkabelung in tatsächliche Quiz/Minicheck/Tutor-Flows (S2.1)
- UI für Lernende (Adaptive-Path-Card, Mastery-Dashboard) (S2.2)
- Decay-Reminder-Email-Sequence (S2.3)

**Bestätige den Plan oder sag, welche Tracks ich vorziehen/streichen soll. Bei Bestätigung starte ich mit Track A (kleinste Lieferung) und arbeite mich durch.**