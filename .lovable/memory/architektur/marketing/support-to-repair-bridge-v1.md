---
name: Support → Repair Bridge v1 (Bridge 3)
description: content_feedback_events SSOT routet Nutzer-/Ticket-Feedback automatisch in passende Repair-Jobs, mit Admin-Triage und MTTR-View
type: feature
---

# Bridge 3 — Support → Product Repair (P0)

Schließt den Kreis: **Lernproblem → Klassifikation → SSOT-Zuordnung → Repair-Job → Audit → Cockpit → Verifikation.**

## SSOT
- **Tabelle `content_feedback_events`** — single source of truth für jedes Content-Feedback.
  - Felder: `source`, `ticket_id`, `entity_type` ENUM (`exam_question|lesson|minicheck|handbook_section|tutor_response|h5p_asset|oral_exam|package`), `entity_id`, `package_id`, `severity` (`low|medium|high|critical`), `reason_code`, `reporter_user_id`, `status` (`open|triaged|repair_enqueued|resolved|rejected|duplicate`), `repair_job_id`, `resolution_*`.
  - RLS: Admin full; Authenticated nur eigene Reports.
- **View `v_content_feedback_pipeline`** — Backlog & MTTR pro entity_type. `service_role` only.
- **Resolve-Helper `fn_cfe_resolve_package_id(entity_type, entity_id)`** — leitet `package_id` für `exam_question`, `lesson`, `minicheck`, `package` ab.

## Trigger-Kette
1. **`trg_ticket_to_feedback`** (AFTER INSERT auf `support_tickets`)
   - Wenn `category='content'` oder `ticket_type='content_error'` und Lesson/Course-Kontext gesetzt → Insert in `content_feedback_events` mit gemappter Severity (urgent→critical, high→high, …).
2. **`trg_cfe_auto_route`** (BEFORE INSERT auf `content_feedback_events`)
   - Resolved fehlende `package_id`.
   - Nur `severity IN ('high','critical')` und `status='open'` → enqueue Repair-Job in `job_queue`.
   - Mapping:
     | entity_type | job_type |
     |---|---|
     | exam_question | `package_repair_exam_pool_quality` |
     | minicheck | `package_repair_lesson_minichecks` |
     | lesson | `repair_learning_content` |
     | handbook_section | `handbook_expand_section` |
     | h5p_asset | `tutor_backfill_assets_for_course` |
     | tutor_response | `package_build_ai_tutor_index` |
     | oral_exam | `tutor_oral_exam_propose` |
     | package | `package_repair_content_feedback` |
   - Setzt Event auf `repair_enqueued` + `repair_job_id`, schreibt Audit `content_feedback_auto_routed` nach `auto_heal_log`.
   - Vertraut bestehenden Job-Guards (Bronze-Lock, Fanout-Cap) — keine eigene Bypass-Logik.

## Neuer Job-Type
- `package_repair_content_feedback` — registriert in `ops_job_type_registry` (lane=`repair`, requires_package_id=true). Sammel-Repair für Package-Level-Feedback ohne spezifische Entity.

## Admin-RPCs
- `admin_get_content_feedback_pipeline()` — Pipeline-Summary (sortiert nach high_severity_open).
- `admin_list_content_feedback_events(_status, _entity_type, _limit)` — Severity-priorisierte Liste.
- `admin_resolve_feedback_event(_event_id, _action, _notes)` — Actions: `resolve | reject | duplicate | triage`. Audit nach `auto_heal_log` action `content_feedback_resolved`.

Alle SECURITY DEFINER + `has_role('admin')`-Gate, REVOKE FROM anon.

## Cockpit
- `ContentFeedbackPipelineCard` (HealCockpitPage Diagnostics-Tab) zeigt Pipeline-Tabelle pro Entity + offene High-Severity-Events mit Triage/Resolve/Reject-Buttons.

## Akzeptanz
- Content-Ticket (category=`content`) → Event in `content_feedback_events` ≤1s.
- High/Critical-Event → Repair-Job in `job_queue` ≤1s (gleicher Insert-Transaktion).
- Admin sieht Backlog + MTTR pro entity_type im Cockpit.
- Resolve/Reject-Action schreibt Audit + setzt Status final.

## Out-of-Scope (P1)
- Tutor-Thumbs-Down/In-App-Report UI (Source `tutor_thumb_down` / `learner_in_app` ist im Enum vorbereitet, aber UI noch nicht angebunden).
- Auto-Verifikation nach Repair-Done (Verify-Loop kommt mit Bridge 4 Outcome).
