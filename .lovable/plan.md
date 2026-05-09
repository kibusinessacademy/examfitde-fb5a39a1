# ExamFit — Engagement / Oral / Readiness Expansion (S6)

## 0. Recon-Ergebnis (SSOT-Bestand, NICHT neu bauen)

| Domäne | Existiert bereits | Erweitern statt ersetzen |
|---|---|---|
| Mastery | `learner_competency_state`, `learner_mastery_event_log`, `recalculate_mastery`, `update_mastery_from_attempt`, `update_mastery_from_minicheck`, `mastery_engine_config`, `admin_simulate_mastery_decay/_path` | Decay-Triggers + Misconception-Aggregat |
| Readiness | `readiness_scores`, `readiness_snapshots`, `exam_readiness_snapshots`, `calculate_readiness_score_v2`, `compute_readiness`, `ops_learner_visible_readiness`, `learner_get_mastery_summary`, `learner_next_best_step`, `get_next_best_action` | Erklärbarkeit (Reason-Codes), Risk-Engine, B2B-Aggregate |
| Daily | `daily_challenges`, `daily_question_picks`, `humor_daily_pick` | Per-User-Adaptive-Picker, Mini-Check-Schicht, Streak-Hook |
| Streak | `learner_profiles.streak_current/_best`, `update_learning_streak` | Consistency-Modell (5/7, Recovery), Audit-Log |
| Oral | `oral_exam_sessions/_turns/_questions/_blueprints`, `get_adaptive_oral_exam_prompts`, `log_oral_exam_turn`, `fn_resolve_oral_trainer_mode`, `cleanup_oral_exam_ephemeral` | Session-Memory-Aggregat, Bewertungs-Pipeline |
| Gamification | `user_badges` (key/label/icon/curriculum/metadata) | Badge-Definitions-Registry + Trigger |
| Retention | `retention_events`, `retention_actions` | Adaptive-Reminder-Decider als Worker |
| B2B | `organization_learners` | Cohort-View + RPC |
| Tutor | `ai_tutor_sessions/_audit/_logs/_messages/_policies`, `ai_tutor_context_index`, Strict-RAG (Core-Rule) | Oral-Mode + Refusal-Pflicht |
| Tracking | `conversion_events` (v2, 6 Pflicht-Events) | Erweitern um 10 neue `daily_*/oral_*/readiness_*/badge_*` Events |

**Kein Neuaufbau** — alles wird über Extension-Migrations + Worker + Views angeschlossen.

## 1. Zielarchitektur (One-Pager)

```text
                ┌─────────────────────┐
   Lern-Event ─►│ learner_mastery_    │── Trigger ─┐
   (attempt,    │ event_log (SSOT)    │            │
   minicheck,   └──────────┬──────────┘            ▼
   simulation)             │              ┌─────────────────┐
                           ▼              │ recalc_mastery  │
                ┌─────────────────────┐   │ + decay         │
                │ learner_competency_ │◄──┘                 │
                │ state               │                     │
                └──────────┬──────────┘                     ▼
                           │             ┌────────────────────────┐
                           ├────────────►│ readiness_engine_v3    │
                           │             │ (calculate_readiness_  │
                           │             │  score_v2 EXTENDED)    │
                           │             └───────────┬────────────┘
                           │                         ▼
                           │             ┌────────────────────────┐
                           │             │ readiness_snapshots    │
                           │             │ (+ reason_codes jsonb) │
                           │             └─────┬──────────────────┘
                           ▼                   ▼
                ┌─────────────────────┐  ┌─────────────────┐
                │ daily_engagement_   │  │ readiness_risk_ │
                │ runner (cron 6h)    │  │ events (NEU)    │
                └──────────┬──────────┘  └────────┬────────┘
                           │                      │
                           ▼                      ▼
                ┌─────────────────────┐  ┌─────────────────┐
                │ daily_challenges    │  │ retention_events│
                │ (per user, adaptive)│  │ adaptive_reminder│
                └─────────────────────┘  └─────────────────┘
                           │                      │
                           └──────────┬───────────┘
                                      ▼
                       conversion_events (v3, +10 Events)
                                      │
                                      ▼
                              GTM/DataLayer
```

## 2. Datenmodell-Erweiterungen (SSOT-Pflege, KEINE neuen Wahrheiten)

**Erweitern (ALTER):**
- `readiness_snapshots` += `reason_codes jsonb`, `risk_level text`, `next_action_key text`, `version text`
- `learner_profiles` += `consistency_7d numeric`, `consistency_30d numeric`, `morning_evening_pattern text`, `recovery_count int`, `exam_target_date date`, `exam_type text`
- `daily_challenges` += `adaptive_strategy text`, `weakness_targets uuid[]`, `expected_minutes int`, `completion_minutes int`, `streak_contribution boolean`
- `oral_exam_sessions` += `kommunikationssicherheit_score`, `vollstaendigkeit_score`, `next_training_recs jsonb`
- `user_badges` += `level text` (bronze/silber/gold/pruefungsreif), `awarded_by text` (rule key)

**Neue Tabellen (nur wo keine SSOT existiert):**
- `badge_definitions` (`badge_key PK`, `category`, `level`, `rule_key`, `criteria jsonb`, `active`) — Single source für Badge-Vergabe-Regeln
- `engagement_daily_state` (`user_id+day PK`, `daily_check_status`, `streak_active`, `consistency_7d`, `tasks_completed jsonb`, `next_action jsonb`) — Lese-Cache (Materialisiert), keine Wahrheit
- `oral_session_memory` (`user_id`, `competency_id`, `weak_terms jsonb`, `recurring_errors jsonb`, `language_patterns jsonb`, `last_seen_at`) — Aggregat aus `oral_exam_turns`
- `readiness_risk_events` (`user_id`, `curriculum_id`, `risk_type` enum [`competency_critical`,`stagnation`,`decay`,`oral_unsicherheit`,`exam_proximity`], `severity int`, `reason_codes jsonb`, `auto_action_key text`)
- `b2b_cohort_readiness` MATERIALIZED VIEW (org_id × curriculum × week, NUR Aggregate, keine Personen)

**Generated Columns / Triggers:**
- `learner_mastery_event_log` AFTER INSERT → enqueue `readiness_recompute` (debounce 60s pro user×curriculum)
- `oral_exam_turns` AFTER INSERT → upsert `oral_session_memory`
- `readiness_snapshots` AFTER INSERT mit `risk_level IN ('critical','high')` → INSERT `readiness_risk_events`

## 3. Workers & Cron (Queue-driven, replay-safe)

| Job-Type | Worker (Edge) | Cron | Idempotenz |
|---|---|---|---|
| `daily_engagement_assemble` | `daily-engagement-runner` | `0 4 * * *` UTC | `(user_id, day)` PK |
| `readiness_recompute` | `readiness-engine` | enqueue-driven | `(user_id, curriculum_id)` debounce |
| `readiness_risk_scan` | `readiness-risk-scanner` | `*/30 * * * *` | risk_event hash |
| `engagement_reminder_decide` | `adaptive-reminder-decider` | `0 * * * *` | `(user_id, day, channel)` |
| `oral_memory_aggregate` | `oral-memory-aggregator` | nach Turn-Insert | upsert |
| `b2b_cohort_refresh` | `b2b-cohort-refresher` | `15 * * * *` | matview refresh |
| `badge_evaluator` | `badge-evaluator` | `*/15 * * * *` | `(user_id, badge_key)` UK |

**Alle** Worker:
- First-Heartbeat-Contract (S5b) Pflicht
- `markFirstHeartbeat` als erste Aktion
- PHK-sensitive → Burst v3 Cap (S5d)
- Audit in `auto_heal_log`

## 4. Readiness-Engine v3 (explainable)

`calculate_readiness_score_v2` → wrappen in `calculate_readiness_score_v3(user_id, curriculum_id)` returns `(score, reason_codes jsonb, risk_level)`.

Inputs (gewichtet, in `mastery_engine_config` parametrisiert):
- mastery coverage 30% · simulation 20% · oral 15% · consistency 10% · confidence 10% · decay-penalty 10% · weakness-count-penalty 5%

Output reason_codes z.B.:
```json
[{"code":"WEAK_LF4","weight":-12},{"code":"ORAL_UNSICHER","weight":-8},{"code":"CONSISTENCY_OK","weight":+6}]
```

UI-Komponente `<ReadinessHero/>` zeigt Score + Top-3-Reasons + Countdown.

## 5. Oral-Exam-Erweiterung

- Neue Worker-Pipeline: `oral-session-evaluator` ruft Lovable AI Gateway (Gemini 2.5 Pro) mit Strict-RAG Citation-Block-Kontrakt aus `ai_tutor_policies`. Refusal-Phrase Pflicht.
- Bewertungs-Schema (Generated): fachlichkeit/struktur/begriffssicherheit/praxisbezug/vollstaendigkeit/kommunikation × 0–100.
- `oral_session_memory` füttert `get_adaptive_oral_exam_prompts` (Adaptivität schon vorhanden, nur Memory-Quelle erweitern).

## 6. Engagement-System (Daily/Streak/Countdown)

- `daily-engagement-runner`: pro aktiven User (last_activity ≤ 14d) wählt 3–5 Fragen aus `exam_questions` gefiltert nach `learner_competency_state.mastery_score < 0.7` + Blueprint-Coverage. Persistiert in `daily_challenges`.
- Streak-Logik: `update_learning_streak` erweitern → Consistency 5/7, Recovery-Tag (verpasster Tag bricht NICHT bei Streak ≥ 3 Wochen).
- Countdown: aus `learner_profiles.exam_target_date` + Readiness → Card im Dashboard.

## 7. Gamification ohne Toxicity

`badge_definitions` als SSOT. Beispiele:
- `lf5_sicher` (rule: competency_id=X mastery≥0.85)
- `consistency_3w` (rule: 21 days consistency_7d ≥ 5)
- `oral_ready` (rule: 3 oral sessions ≥ 75)

`badge-evaluator` setzt Trigger über `learner_mastery_event_log` und `oral_exam_sessions`. Kein XP, keine Coins.

## 8. B2B Readiness Layer

- `admin_get_b2b_cohort_readiness(org_id, curriculum_id)` (SECURITY DEFINER, has_role `org_admin`)
- Liefert nur **aggregierte** Cohort-Metriken aus MV `b2b_cohort_readiness`. Keine Personenbezüge ohne Opt-in.
- Dashboard `/b2b/readiness/:org` mit Cohort-Heatmap + Risk-Indicators.

## 9. Analytics / Tracking-Erweiterung

In `conversion_events` (Generated Column `package_id` schon da) zusätzliche Events:
`daily_check_started/_completed`, `readiness_changed`, `streak_updated`, `oral_exam_started/_completed`, `badge_unlocked`, `weakness_recovered`, `countdown_viewed`, `onboarding_completed`.

Guard: `scripts/guards/engagement-events-guard.mjs` validiert Pflichtfelder pro Event-Typ in CI.

## 10. UI-Komponentenplan (Mobile-First, Design-System v2 Tokens)

`src/components/learner/`:
- `ReadinessHero.tsx`, `DailyMissionCard.tsx`, `WeaknessRadar.tsx`, `CountdownCard.tsx`, `OralReadinessCard.tsx`, `LearningRhythmHeatmap.tsx`, `CompetencyGraph.tsx`, `NextBestActionCard.tsx`

Neue Page `/lernen/heute` als Daily-Hub. Bestehende `/dashboard` bleibt; Hero ersetzt nur den oberen Slot.

## 11. Governance, CI, Healing

- **DB**: alle neuen Tabellen mit RLS (`user_id = auth.uid()` für Learner-Daten; `has_role(org_admin)` für B2B-Aggregate)
- **CI**:
  - `s6-readiness-engine.test.ts` (reason_codes deterministisch)
  - `s6-engagement-events.test.ts` (Event-Pflichtfelder)
  - `s6-oral-rag-citation.test.ts` (Refusal-Phrase erzwungen)
  - `s6-badge-rules.test.ts` (jede Definition hat Rule-Key)
  - First-Heartbeat-Drift (S5d) für alle neuen Worker
- **Healing**: `admin_get_engagement_drift` View — User mit `learner_competency_state` aber ohne `daily_challenges` letzte 7d → enqueue `daily_engagement_assemble`.

## 12. Rollout-Plan (4 Wellen, je 1 Migration-Concern)

| Welle | Inhalt | Risk |
|---|---|---|
| **W1 — Foundation** | ALTER readiness_snapshots/learner_profiles/daily_challenges, neue Tabellen badge_definitions/engagement_daily_state/oral_session_memory/readiness_risk_events, RLS, MV b2b_cohort_readiness | low |
| **W2 — Engines** | calculate_readiness_score_v3, update_learning_streak v2, oral-session-evaluator, badge-evaluator, daily-engagement-runner (alle Edge) | medium |
| **W3 — UI** | 8 Learner-Komponenten + /lernen/heute, B2B-Cohort-Page, Tracking-Wires | low |
| **W4 — Crons + Guards** | 7 Cron-Jobs scharf, CI-Guards, Healing-View, Memory-Update | low |

Jede Welle: separate Migration · Smoke-SQL · Rollback-Hint · `auto_heal_log` Audit · CI-Test grün.

## 13. Risk-Assessment & Mitigations

| Risiko | Mitigation |
|---|---|
| Decay-Loop floods readiness_recompute | 60s debounce pro user×curriculum + queue-side dedupe |
| LLM-Drift im Oral | Strict-RAG Citation Pflicht + Refusal-Phrase + ai_tutor_audit |
| Phantom Badges (Race) | UK `(user_id, badge_key, curriculum_id)` + ON CONFLICT DO NOTHING |
| B2B-Datenleck | RLS strikt; Aggregate-MV hat KEINE user_id; RPC has_role-gated |
| Streak-Toxicity | Recovery-Tage + Consistency statt Brutto-Streak in UI primär |
| Daily-Coldstart bei neuen Usern | Onboarding seedet 3 leichte Fragen aus `daily_question_picks` Pool |
| Performance Mastery-Recompute | Bestehender Pfad unverändert; nur AFTER INSERT enqueue |

## 14. Was NICHT in S6 kommt (bewusst)

- Keine eigene Push-Infra (nutzt vorhandene `email-sequence-worker` + retention_events).
- Keine neuen Avatare/Coins.
- Keine direkte client-seitige Mastery-Schreibwege.
- Keine parallele Streak-Logik außerhalb `update_learning_streak`.

## 15. Erste konkrete Migration (W1) — bereit zum Ziehen nach Approval

```sql
ALTER TABLE readiness_snapshots
  ADD COLUMN IF NOT EXISTS reason_codes jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS next_action_key text,
  ADD COLUMN IF NOT EXISTS version text DEFAULT 'v3';
ALTER TABLE learner_profiles
  ADD COLUMN IF NOT EXISTS consistency_7d numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consistency_30d numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exam_target_date date,
  ADD COLUMN IF NOT EXISTS exam_type text;
CREATE TABLE IF NOT EXISTS badge_definitions (...);
CREATE TABLE IF NOT EXISTS engagement_daily_state (...);
CREATE TABLE IF NOT EXISTS oral_session_memory (...);
CREATE TABLE IF NOT EXISTS readiness_risk_events (...);
-- + RLS + Indexe + auto_heal_log Audit
```

---

**Nächster Schritt nach Freigabe**: Welle 1 als einzelne Migration ziehen, danach W2-Worker einzeln deployen, je mit Smoke + Test.