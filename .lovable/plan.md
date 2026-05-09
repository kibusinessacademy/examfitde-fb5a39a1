## S3 — Mastery v2 Wiring + Gate History Dashboard + Auto-Pulse Impact + Decay-τ Simulator

Vier Tracks. Eine Migration je Concern. Signatur-Fix vorab.

---

### Pre-Fix — `update_mastery_from_attempt` Signatur prüfen + härten

Sicherstellen, dass `p_correct boolean` named-parameter sauber ist (kein implizites `int`). Falls Drift: Drop+Recreate mit explizit benannten Parametern, identische Body-Logik.

---

### Track A — `learner_next_best_step` produktreif + Trigger-Verkabelung (S2.1)

**SSOT-Helper**: `update_mastery_from_attempt` als single choke-point. Alle Quellen rufen ihn auf, niemals direkter Schreibzugriff.

**Verkabelung** (existing flows → mastery update):
1. **Quiz** — `submit_quiz_answer` / `quiz_attempts` AFTER INSERT trigger → `update_mastery_from_attempt(event_type='quiz')`
2. **MiniCheck** — bestehende `update_mastery_from_minicheck` ruft zusätzlich `update_mastery_from_attempt(event_type='minicheck')` (Bridge, kein Doppelschreib-Risiko da unterschiedliche Tabelle: `user_competency_progress` ist v1 / `learner_competency_state` ist v2)
3. **Exam** — exam_attempts AFTER INSERT trigger
4. **Tutor** — tutor evaluation event → mastery update mit `event_type='tutor'`

Helper-Funktion `_resolve_competency_for_question(question_id)` (SECURITY DEFINER) löst question→competency aus `exam_questions`/`competencies`.

**`learner_next_best_step` Erweiterung** (bereits existiert): Action-Reasoning ergänzen mit konkretem Payload je Action-Type:
- `REPAIR` (mastery<60) → `payload = {minicheck_id, recommended_questions[]}`
- `DRILL` (60–79) → `payload = {drill_set_size, focus_misconception_tags[]}`
- `REINFORCE` (80–89) → `payload = {challenge_pool_id}`
- `CHALLENGE` (≥90) → `payload = {exam_simulation_id}`
- Decay-Boost-Reason mit `days_since_practice` im payload.

**Tests**: `mastery-v2-wiring.test.ts` — Trigger-Insert in shadow tables erzeugt mastery-event-log entry, next_best_step antwortet mit erwartetem action.

---

### Track B — Gate-History Dashboard (Drilldown + Drift-Visualisierung)

**Neue Page** `src/pages/admin/v2/GateHistoryDashboardPage.tsx` (route `/admin/heal/gate-history`):
- Tab 1 **Pro Paket**: Filter (package_key, decision, lane, time-range), Tabelle mit Decision-Wechseln, Inline-Sparkline der letzten 30 Decisions.
- Tab 2 **Drift über Zeit**: Stacked-Area-Chart (recharts) — Decisions/Tag pro Kategorie (READY_TO_PUBLISH / REPAIR_REQUIRED / BRONZE_LOCKED / NEEDS_REVIEW) letzte 30 Tage.
- Tab 3 **Lane-Drilldown**: Pivot Lane × Decision (24h / 7d / 30d) mit count + delta vs vorherige Periode.

**RPCs** (admin-gated):
- `admin_get_gate_decision_drift(p_window_days int default 30)` — Tagesaggregat aus `quality_gate_decision_history`
- `admin_get_gate_decision_lane_pivot(p_window_hours int default 168)` — Lane × Decision Pivot mit prev-period-delta
- `admin_get_gate_decision_package_timeline(p_package_id uuid, p_limit int default 30)` — bereits vorhanden als `admin_get_gate_decision_history`, ggf. wrappen.

**SSOT**: Alle Reads aus `quality_gate_decision_history`. Kein Realtime-Recompute.

---

### Track C — Auto-Pulse End-to-End Wirkungsmessung

**Ziel**: Before/After-Vergleich um zu beweisen, dass Auto-Pulse die Pipeline-Qualität verbessert (nicht nur Logs füllt).

**View** `v_auto_pulse_impact_30m` — pro Pulse-Decision (last 7d):
- `before_pending_default_pool, after_pending_default_pool_30m`
- `before_failure_rate_15m, after_failure_rate_15m_30m`  
- `before_oldest_min, after_oldest_min_30m`
- `gate_throughput_30m_after` (jobs completed in 30 min after pulse)
- `delta_pending, delta_failure_rate, delta_throughput_lift`

**RPC** `admin_get_auto_pulse_impact(p_window_days int default 7)` (admin) — aggregiert je Decision-Pfad:
- `decisions_count, avg_pending_delta, avg_failure_rate_delta, avg_throughput_lift, p50_recovery_min, success_rate` (success = pending sank ≥10% in 30min nach pulse)

**UI** `AutoPulseImpactCard` in HealCockpit (Diagnostics-Tab neben RecoveryPulseHistoryCard):
- KPI-Kacheln: ø Throughput-Lift, ø Pending-Reduktion, Success-Rate %
- Tabelle pro Decision-Pfad mit before/after Metriken
- Conditional-Format: grün wenn Lift>0, rot wenn negativ

**Tests**: Anon-refusal für `admin_get_auto_pulse_impact`, Shape-Contract der Felder.

---

### Track D — Decay-τ konfigurierbar + Admin-Simulator

**Tabelle** `mastery_engine_config` (single-row enforce via `id = 'singleton'` CHECK):
- `decay_tau_days numeric default 14` 
- `ewma_alpha numeric default 0.30`
- `confidence_sample_anchor numeric default 8.0`
- `repair_threshold numeric default 60`
- `drill_threshold numeric default 80`
- `reinforce_threshold numeric default 90`
- `updated_at, updated_by`

RLS: admin SELECT/UPDATE only. `update_mastery_from_attempt` und `learner_next_best_step` lesen Konfig (mit Fallback auf Defaults wenn Tabelle leer).

**RPCs**:
- `admin_get_mastery_engine_config()` (admin)
- `admin_update_mastery_engine_config(p_decay_tau_days, p_ewma_alpha, ...)` (admin) mit CHECK-Validation + Audit in `auto_heal_log`
- `admin_simulate_mastery_decay(p_initial_mastery numeric, p_days_array int[], p_tau_override numeric default null)` returns `[{day, mastery_score, exam_readiness}]` — pure Funktion, kein DB-Write
- `admin_simulate_mastery_path(p_attempts jsonb, p_tau_override numeric, p_alpha_override numeric)` — simuliert ganze Lernsequenz (Liste von `{correct, days_since_prev}`) → Mastery-Verlauf

**UI** `src/pages/admin/v2/MasteryEngineSimulatorPage.tsx` (route `/admin/mastery/simulator`):
- Sektion 1 **Live-Config**: Form mit allen Konfig-Werten + Save-Button + History-Strip (last 10 changes aus auto_heal_log)
- Sektion 2 **Decay-Simulator**: Slider Initial-Mastery + τ-Slider, Line-Chart Mastery & Readiness über 60 Tage
- Sektion 3 **Path-Simulator**: Editierbare Tabelle (correct y/n + days_since_prev), zwei Varianten parallel (Default τ vs custom τ), Vergleichs-Chart

**Tests**: Config-Update-Audit, Simulator-Determinismus (gleiche Inputs → gleiche Outputs), Boundary (τ=0 → instant decay, alpha=1 → no smoothing).

---

### Migrationen (sequenziell)

| # | Concern |
|---|---------|
| 1 | Pre-Fix: `update_mastery_from_attempt` Signatur-Recreate falls nötig |
| 2 | Track A: Trigger-Verkabelung quiz/exam/tutor + payload-Erweiterung in `learner_next_best_step` |
| 3 | Track B: 3 Drift-RPCs |
| 4 | Track C: `v_auto_pulse_impact_30m` + Impact-RPC |
| 5 | Track D: `mastery_engine_config` Tabelle + Config-RPCs + Simulator-RPCs + Refactor `update_mastery_from_attempt`/`learner_next_best_step` auf Config-Read |

### Code-Änderungen

| Datei | Zweck |
|---|---|
| `src/pages/admin/v2/GateHistoryDashboardPage.tsx` | NEU — Drift+Lane+Paket Drilldown |
| `src/pages/admin/v2/MasteryEngineSimulatorPage.tsx` | NEU — Config + Decay/Path Simulator |
| `src/components/admin/heal/cards/AutoPulseImpactCard.tsx` | NEU — Wirkungsmessung |
| `src/pages/admin/v2/HealCockpitPage.tsx` | + Impact-Card im Diagnostics-Tab + Link zur GateHistory-Page |
| `src/App.tsx` | + 2 Routes (gate-history, mastery/simulator) admin-gated |
| `src/test/learner/mastery-v2-wiring.test.ts` | NEU — Trigger-Wirkung |
| `src/test/ops/auto-pulse-impact.test.ts` | NEU — Impact-RPC Contract |
| `src/test/learner/mastery-engine-config.test.ts` | NEU — Config + Simulator |

### Memory & Audit
- `mem://architektur/ops/gate-history-dashboard-v1.md`
- `mem://architektur/ops/auto-pulse-impact-measurement-v1.md`
- `mem://features/learner/mastery-engine-config-and-simulator-v1.md`
- `mem://architektur/learner/mastery-v2-trigger-wiring-v1.md`
- Index-Update: Core-Regel ergänzen "Mastery-Engine-Konstanten NUR via mastery_engine_config; niemals hardcoded außer Fallback-Default."

### Out-of-Scope (S4)
- Lernenden-UI (Adaptive-Path-Card, Mastery-Dashboard) — bleibt S2.2
- Decay-Reminder-Email-Sequence (`mastery_decay_reminder`) — bleibt S2.3
- A/B-Test-Framework für τ-Werte mit Cohort-Splitting

### Rollback-Hinweise je Migration in DB-Comment + Memory.

---

**Bestätige oder priorisiere um.** Bei OK starte ich mit Pre-Fix → Track A → B → C → D.