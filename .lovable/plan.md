# Lifecycle Bridges P0 — Roadmap

Du hast 10 Brücken benannt. Bevor ich Code schreibe, bestätige bitte den Scope. Empfehlung: **drei P0-Brücken in genau dieser Reihenfolge** (jede ist eine eigene Migration-Welle, mit Worker + SLA-Cron + Cockpit-Card + Smoke + Memory-Leaf — analog zum bewährten Pattern aus Post-Publish/Post-Purchase).

## Bridge 1 — Delivered → Activated (P0)

**Trigger:** `learner_entitlements.activated_at IS NOT NULL` (erste je User) → Activation-Orchestrator.

**Fanout-Jobs (neu in `ops_job_type_registry`):**
- `activation_welcome_sequence_enqueue` (verdrahtet email_delivery_queue Loop B)
- `activation_goal_capture_prompt` (setzt `learner_profile.goal_capture_pending=true`)
- `activation_exam_date_capture_prompt`
- `activation_study_plan_generate` (RPC `fn_generate_study_plan_v1` aus mastery + exam_date)
- `activation_streak_initialize` (insert `learner_streaks` row)
- `activation_first_minicheck_seed` (picks easiest LF1 minicheck → `learner_next_best_step`)

**SSOT-View:** `v_learner_activation_state` mit state-machine:
`NOT_STARTED | ONBOARDING | ACTIVATED | ENGAGED | AT_RISK | DORMANT`
abgeleitet aus `entitlement.activated_at`, `last_event_at`, `streak_days`, `minichecks_completed_count`.

**SLA-Wächter:** Cron 5min — Activation-Fanout muss ≤10min nach `delivery_confirmed` abgeschlossen sein, sonst auto_heal_log `activation_sla_breach`.

**Worker:** `learner-activation-worker` (analog post-purchase-delivery-worker).

**Cockpit:** `ActivationFunnelCard` — counts pro state, "DormantRescue" repair button.

## Bridge 2 — Mastery → Exam Readiness (P0)

**Bereits vorhanden:** `useExamReadiness`, `calculate_exam_readiness`, `compute_readiness`. **Lücke:** kein orchestrierter Lifecycle, keine LF/Blueprint/Zeitdruck-Gewichtung, keine `AT_RISK/CRITICAL`-Eskalation, kein Auto-Intervention.

**Neu:**
- View `v_exam_readiness_v2` — kombiniert: LF-Coverage %, Blueprint-Coverage %, Sim-Score 7d-trend, Error-Type-Distribution, Repetition-Stability (mastery decay), Days-To-Exam-Pressure.
- Verdict-Enum: `READY (≥85)` | `PARTIAL (70-84)` | `AT_RISK (55-69)` | `CRITICAL (<55)`.
- RPC `fn_exam_readiness_v2(user_id, curriculum_id)` SECURITY DEFINER.
- Trigger nach jedem minicheck/sim_session → enqueue `learner_readiness_recompute` (debounced 30s).
- Bei `AT_RISK`/`CRITICAL`-Übergang → enqueue `learner_intervention_dispatch` (Tutor-Hint, Weakness-Drill, Email-Sequence "rescue").
- SSOT-Audit: `learner_readiness_history` (state, score, verdict, computed_at).

**Cockpit:** `ExamReadinessDistributionCard` pro Curriculum — READY/PARTIAL/AT_RISK/CRITICAL counts + Trend.

## Bridge 3 — Support → Product Repair (P0)

**Lücke:** `support_tickets` ist isoliert — kein Link zu Content-Entity, kein Auto-Enqueue eines Repair-Jobs.

**Neu:**
- Tabelle `content_feedback_events` (FK → ticket_id?, entity_type ENUM `exam_question|lesson|h5p_asset|tutor_response|handbook_section`, entity_id UUID, severity, reason_code, reporter_user_id, status `open|triaged|repair_enqueued|resolved|rejected`).
- Trigger `trg_feedback_event_auto_route` → wenn `severity in ('high','critical')` und entity bekannt → enqueue Repair-Job pro entity_type (mapping: exam_question→`package_repair_exam_pool_quality`, lesson→`repair_learning_content`, h5p_asset→`asset_revalidate`, tutor_response→`tutor_index_partial_rebuild`, handbook→`handbook_expand_section`).
- RPC `admin_resolve_feedback_event(id, action)` mit revalidation-hook.
- Ticket→Feedback-Bridge: bei `support_tickets.context_course_id IS NOT NULL` und category `content_error` → auto-insert `content_feedback_events`.
- View `v_content_feedback_pipeline` — open / triaged / repair_enqueued / resolved counts pro entity_type, MTTR.

**Cockpit:** `ContentFeedbackPipelineCard` — Backlog + "Triage" Buttons.

## Out-of-Scope (P1+, später)
4 Certified/Completed · 6 Auto-Optimization · 7 Cost-Governance · 8 Compliance · 9 Multi-Channel · 10 Human-Escalation — separate Wellen.

## Pattern pro Bridge (1 Welle = 5 Schritte)
1. Migration A: Schema + SSOT-View + Trigger
2. Migration B: Job-Types in `ops_job_type_registry` + Orchestrator-Fanout-Function + SLA-Detector
3. Edge Function: dedizierter Worker mit RPC-MAP
4. Cron: `*-worker-2min` + `*-sla-5min` (via `supabase--insert`, da projekt-spezifische Keys)
5. Cockpit-Card + Memory-Leaf + Smoke-Erweiterung

## Frage vor Ausführung
**Bestätige ich die 3 Brücken in dieser Reihenfolge und Tiefe?** Oder soll ich:
- (a) nur **Bridge 1 (Activation)** in dieser Welle vollständig schließen und Bridge 2+3 als separate Bestätigungen,
- (b) alle 3 in einer großen Welle (≈4 Migrations + 3 Edge-Functions + 3 Cards),
- (c) andere Priorisierung (z.B. Support→Repair zuerst, weil Quality-Loop)?
