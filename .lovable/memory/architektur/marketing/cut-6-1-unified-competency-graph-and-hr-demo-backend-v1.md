---
name: Cut 6.1 Phase 1 — Unified Competency Graph SSOT + HR-Demo Backend
description: SSOT-View über Beruf→Lernfeld→Kompetenz, Admin+Public RPCs, HR-Painpoint-Mapping mit 6 Seeds und Match-RPC
type: feature
---

# Cut 6.1 Phase 1 (2026-05-26) — Backend-SSOT für HR-Demo

**Strategischer Kontext:** Nach Market-Activation-Pivot + Cut 5 Freeze. Wahl: Cut-7-P0-Baustein (Unified Competency Graph) als Fundament für Cut-6-Aktivierung (HR-Demo Persona, Hybrid kuratiert+AI).

## Lieferungen (Phase 1, Backend-only)

### L1 — Unified Competency Graph SSOT
- **View** `v_unified_competency_graph` — Projektion: `course_packages → curricula → learning_fields → competencies` + LATERAL-Counts für `question_blueprints` / `oral_exam_blueprints` / `lessons` / `exam_questions(approved)` / `oral_exam_questions`.
- Locked: `REVOKE FROM PUBLIC,anon,authenticated; GRANT TO service_role` (SQL-Pitfalls-Rule).
- **Admin-RPC** `admin_get_competency_graph_for_package(_package_id uuid)` — SECURITY DEFINER + `has_role(auth.uid(),'admin')` Gate, gibt JSON-Tree mit learning_fields + competency_summary.
- **Public-RPC** `public_get_demo_competency_summary(_package_id uuid)` — SECURITY DEFINER, hartes Gate `is_published=true` (sonst `error: not_available`), liefert NUR Titel + Counts (keine Question-Inhalte). anon-zugänglich.
- **Audit-Contract** `competency_graph_demo_view` registriert in `ops_audit_contract` mit required_keys `['package_id','requester_persona']`, owner_module `cut_6_1_demo`, schema_version 1.

### L2 — HR-Painpoint-Mapping
- **Tabelle** `hr_demo_painpoint_map(painpoint_key PK, painpoint_label, painpoint_description, search_terms text[], target_track, weight, active)`.
- **RLS:** public read (`active=true`), admin write.
- **Seed:** 6 HR-Painpoints — `kuendigungsgespraech`, `onboarding`, `compliance_schulung`, `mitarbeiterentwicklung`, `konflikte`, `ausbildung_ihk`.
- **Match-RPC** `public_match_packages_for_painpoint(_painpoint_key, _limit≤5 default 3)` — Score = `term_hits*10 + track_match_bonus*5`, nur `is_published=true AND archived=false`. Smoke 2026-05-26: `ausbildung_ihk` → AEVO (Score 30) korrekt Top-1.

## Architectural Continuity
SSOT_FIRST + EXTEND_EXISTING + NO_PARALLEL_SYSTEMS + BRIDGE_DONT_FORK eingehalten — keine neue Knoten-Tabelle, Graph = View-Projektion. Workflow-Patterns (Cut 7) kommen als Spoke-Tabelle ohne Refactor.

## Noch offen (Cut 6.1 Phase 2)
- **L3** `lead_activation_signals` + `record_activation_signal` RPC + `fn_demo_rate_limit_check`.
- **Edge-Function** `hr-demo-personalize` (Lovable AI Gateway `google/gemini-3-flash-preview`, SSE-Streaming, 402/429 Surfacing).
- **Frontend** `/demo/hr` (Input → MatchResults → PersonalizedInsights-Stream → CTA), Design-Tokens v2, mobile-first.
- **Tests** Smoke (public-RPC nur published), conversion_events package_id-SSOT, A11y axe-Lauf, Full-Vitest-Gate.
- **Memory-Freeze** nach Full-Suite-grün.

## Rollback-Hint
```sql
DROP FUNCTION IF EXISTS public.public_match_packages_for_painpoint(text,int);
DROP TABLE IF EXISTS public.hr_demo_painpoint_map;
DROP FUNCTION IF EXISTS public.public_get_demo_competency_summary(uuid);
DROP FUNCTION IF EXISTS public.admin_get_competency_graph_for_package(uuid);
DROP VIEW IF EXISTS public.v_unified_competency_graph;
DELETE FROM public.ops_audit_contract WHERE action_type='competency_graph_demo_view';
```
