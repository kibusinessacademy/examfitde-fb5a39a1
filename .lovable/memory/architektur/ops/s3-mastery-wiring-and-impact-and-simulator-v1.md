---
name: S3 — Mastery Wiring + Gate History Dashboard + Auto-Pulse Impact + Decay-τ Simulator
description: Mastery-Engine-Config (singleton), bridge RPC record_attempt_mastery_bulk, learner_next_best_step.payload, minicheck→v2 bridge, gate-history drift+lane+timeline RPCs, auto-pulse impact view + RPC, simulator RPCs + UI.
type: feature
---

# S3 — Adaptive-Engine Konsolidierung (2026-05-09)

## Track A — Mastery Wiring + next_best_step v2
- `mastery_engine_config` (singleton): τ, α, sample_anchor, REPAIR/DRILL/REINFORCE thresholds, decay_alert_threshold. RLS admin-read only; writes nur via `admin_update_mastery_engine_config` (audited).
- `fn_get_mastery_config()` STABLE — single read-path mit Fallback-Defaults wenn Tabelle leer.
- `update_mastery_from_attempt` liest jetzt α, τ, anchor aus Config; signature `p_correct boolean` bestätigt korrekt.
- `learner_next_best_step` v2 (DROP+CREATE): zusätzliches `payload jsonb` mit `{days_since_practice, samples_total, misconception_tags, recurring_question_ids, thresholds}`. Schwellenwerte aus Config.
- Helper `_resolve_competency_for_question(uuid)` — STABLE SECURITY DEFINER lookup auf exam_questions.
- Bridge `record_attempt_mastery_bulk(user, course, event_type, attempts jsonb)` — Quiz/Exam/Tutor-Flows rufen einmalig pro Sitzung mit Liste von `{question_id, correct, response_ms, misconception_tags}`. Helper resolved competency, ruft `update_mastery_from_attempt` per Attempt. Skipped attempts ohne Competency werden gezählt.
- `update_mastery_from_minicheck` brückt jetzt automatisch in v2-State (curriculum_id == course_id im v2-Modell).

## Track B — Gate-History Dashboard
- `admin_get_gate_decision_drift(p_window_days)` — Tagesaggregat per (day, decision) für Stacked-Area-Chart.
- `admin_get_gate_decision_lane_pivot(p_window_hours)` — Lane × Decision Pivot mit Δ vs. Vorperiode (gleiche Fensterlänge).
- `admin_get_gate_decision_package_timeline(package_id, limit)` — Timeline pro Paket inkl. inputs-snapshot für Drill-down.
- UI: `src/pages/admin/v2/GateHistoryDashboardPage.tsx` mit 3 Tabs (Drift / Lane / Paket), recharts AreaChart + Tabellen + JSON-Inputs-Drawer.

## Track C — Auto-Pulse Wirkungsmessung
- `v_auto_pulse_impact_30m` (service_role only): Pairs jede `auto_recovery_pulse_decide`-Entscheidung mit dem Snapshot ~30min später (LATERAL Join auf nächste Pulse-Log-Zeile zwischen +25 und +35min). Fields: before_pending/oldest/failure_rate, after_*, delta_*, pending_reduction_pct, pulse_succeeded (>=10% Reduktion bei pulsed-Decision).
- `admin_get_auto_pulse_impact(p_window_days)` — aggregiert pro Decision-Pfad: avg deltas, success_rate_pct, total pulsed jobs.
- UI: `AutoPulseImpactCard.tsx` im Diagnostics-Tab — KPI-Kacheln (Success-Rate, ø Pending Δ, Pulsed Jobs) + Tabelle pro Pfad mit grünen/roten Δ-Badges.

## Track D — Decay-τ konfigurierbar + Simulator
- `admin_get_mastery_engine_config()` / `admin_update_mastery_engine_config(...)` — alle Felder optional, COALESCE-Update, Audit in `auto_heal_log` action_type=`mastery_engine_config_update` mit before/after.
- `admin_simulate_mastery_decay(initial, days[], tau_override?)` — pure decay-Verlauf für gegebene Tage.
- `admin_simulate_mastery_path(attempts jsonb, tau?, alpha?, anchor?)` — simuliert ganze Lernsequenz (`{correct, days_since_prev}`) → mastery/confidence/decay/readiness pro Step. Reines DB-internes Recompute, kein Side-Effect.
- UI: `src/pages/admin/v2/MasteryEngineSimulatorPage.tsx` mit Live-Config-Form + Decay-LineChart + Path-LineChart (JSON-Editor + τ/α-Override).

## SSOT-Regeln (Index-Update)
- Mastery-Engine-Konstanten NUR via `mastery_engine_config` lesen; niemals hardcoded außer Fallback-Default in `fn_get_mastery_config`.
- Quiz/Exam/Tutor-Flows schreiben Mastery NUR via `record_attempt_mastery_bulk` oder `update_mastery_from_attempt` (single choke-point).
- Gate-History wird ausschließlich via `fn_snapshot_quality_gate_decisions` (10-min-Cron + admin manual snapshot) befüllt.

## Tests
- `src/test/learner/mastery-engine-config.test.ts` (9 Cases): admin-RPC anon-refusal × 6, RLS-Lock auf config-Tabelle, bridge-RPC anon-refusal, gate-history-RPCs anon-refusal × 3.
- bestehender `mastery-v2.test.ts` bleibt grün (signature update_mastery_from_attempt unverändert).
- bestehender `dag-heal-and-alerts.test.ts` bleibt grün.

## Verkabelung in Quiz/Exam/Tutor (S2.1, jetzt unblocked)
- Pattern für nächste Sprints: `await supabase.rpc('record_attempt_mastery_bulk', { p_user_id, p_course_id, p_event_type: 'quiz'|'exam'|'tutor', p_attempts: [{question_id, correct, response_ms, misconception_tags?}] })` direkt nach Attempt-Submit.
- Edge functions können mit service-role Key auch für andere User schreiben.

## Out-of-Scope (S4)
- Lernenden-UI (Adaptive-Path-Card auf Dashboard, Mastery-Heatmap pro Curriculum).
- Decay-Reminder-Email-Sequence `mastery_decay_reminder` (email_delivery_queue).
- A/B-Test-Framework für τ-Werte mit Cohort-Splitting.
- Auto-Pulse-Impact: erweitern um throughput aus job_queue completion-rate (nicht nur pending-snapshots).

## Rollback je Track
- A: DROP FUNCTION record_attempt_mastery_bulk, _resolve_competency_for_question; CREATE OR REPLACE update_mastery_from_attempt mit hardcoded α=0.30/τ=14; DROP FUNCTION learner_next_best_step + recreate ohne payload-column; CREATE OR REPLACE update_mastery_from_minicheck ohne v2-bridge; DROP TABLE mastery_engine_config CASCADE; DROP FUNCTION fn_get_mastery_config.
- B: DROP FUNCTION admin_get_gate_decision_drift, admin_get_gate_decision_lane_pivot, admin_get_gate_decision_package_timeline.
- C: DROP VIEW v_auto_pulse_impact_30m; DROP FUNCTION admin_get_auto_pulse_impact.
- D: DROP FUNCTION admin_get_mastery_engine_config, admin_update_mastery_engine_config, admin_simulate_mastery_decay, admin_simulate_mastery_path.
