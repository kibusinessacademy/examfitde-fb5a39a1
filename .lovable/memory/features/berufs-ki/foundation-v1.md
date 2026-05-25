---
name: Berufs-KI Foundation v1 (Phase 1)
description: Eigenständige Produktlinie neben ExamFit. SSOT-Bridge auf course_packages/learning_fields/competencies. Workflow-Definition + Run-Audit Tabellen, Edge berufs-ki-run via Lovable AI Gateway, /berufs-ki Hub + /berufs-ki/app Workbench, OS-Spine-Integration via useOsBeruf.
type: feature
---

# Berufs-KI Foundation v1 — eigenständige Produktlinie

## Positionierung
„Die KI kennt deinen Beruf." — kein Chatfenster, keine Prompt-Sammlung. Strukturierte Berufs-Workflows mit Input/Output-Vertrag.

## Tabellen
- **`berufs_ki_workflow_definitions`** — Katalog. SSOT-Bridge: `curriculum_id` (FK course_packages), `learning_field_id`, `competency_ids[]`, `blueprint_refs jsonb`. CHECK constraints für category/tier/compliance/risk. RLS: public read where is_active; admin write via has_role.
- **`berufs_ki_workflow_runs`** — Audit pro Lauf. Owner-only read, INSERT nur via service_role. Status: ok/error/blocked/rate_limited.

## Edge Function
`berufs-ki-run` — JWT-Pflicht, daily-limit 10/user (free), Field-Validation aus `input_schema.fields`, Template-Interpolation `{{key}}`, Lovable AI Gateway (default `google/gemini-2.5-pro`), 429/402 Pass-Through, Audit-Insert nach jedem Lauf.

## Frontend SSOT
- `src/lib/berufs-ki/types.ts` — WorkflowDefinition, WorkflowField, WorkflowRunResult.
- `src/lib/berufs-ki/api.ts` — `listWorkflows({category, curriculumId})`, `getWorkflowBySlug`, `runWorkflow(slug, inputs, beruf_slug)`.
- `src/lib/berufs-ki/copy.ts` — BERUFS_KI brand SSOT, CATEGORY_LABEL/DESCRIPTION.
- `src/components/berufs-ki/WorkflowRunner.tsx` — DRY Component, dynamisches Form aus input_schema, OS-Beruf-Pre-Fill.

## Routes
- `/berufs-ki` — `BerufsKIHubPage` (Marketing, 6 Kategorien als Cards).
- `/berufs-ki/app` — `BerufsKIWorkbenchPage` (Catalog + Runner, BerufIdentityChip).
- Beide in `route-registry.ts` allowlisted.
- Legacy `/berufski/*` bleibt 410.

## Seeds (6 universelle Workflows, Free-Tier)
1. `pro-kundenmail-antworten` (kommunikation)
2. `kpi-analyse-erklaeren` (analyse)
3. `meeting-protokoll-strukturieren` (dokumentation)
4. `tagesplan-priorisieren` (organisation)
5. `fachgespraech-vorbereiten` (fach)
6. `thema-erklaeren-meinem-niveau` (lernhilfe)

## Bridges
- OS-Spine: `useOsBeruf()` pre-fills `beruf`-Field automatisch im Runner.
- /work/* B2B-Funnel verlinkt jetzt primär auf `/berufs-ki/app`.

## Phase 2+ (deferred)
- Tier-Enforcement gegen entitlements/learner_course_grants (Bridge, kein Fork).
- 30 berufsspezifische Workflows mit curriculum_id-Bindung (Industriekaufmann, FIAE, AEVO, …).
- Admin-CRUD `/admin/berufs-ki/workflows`.
- History-Drawer + Output-Sektionen-Parser (executive_summary/risiken/folgeaktionen).
- Cross-Sell ExamFit ↔ Berufs-KI nach Prüfungs-Pass.

## Bewusst NICHT umgesetzt
- Code-Identifier `berufski` bleiben (nur User-Facing-Strings auf „Berufs-KI" umbenannt: WorkHomePage, BerufsKIBuyPage, BerufsKISuccessPage).
- Keine Migration der Stripe-Edge `berufski-checkout`.
- Keine separate Tier-Tabelle — `tier_required` als CHECK-Spalte.
