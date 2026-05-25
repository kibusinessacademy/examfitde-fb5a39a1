---
name: Berufs-KI Phase 4 — Community Workflow Intelligence v1
description: Strukturierte Community-Submissions mit AI-Precheck (Duplicate/Governance/Quality), Admin Review Center, Approval-Pipeline zu offiziellen Workflows, Community-Intelligence-KPIs.
type: feature
---

## Schema
- `berufs_ki_workflow_submissions` — strukturierte Einsendungen (title, goal, beruf_slug, category, proposed_inputs/outputs, workflow_steps, risks). Status-Enum `berufs_ki_submission_status`. RLS: User sehen/bearbeiten nur eigene Drafts/needs_changes; Admins all.
- `berufs_ki_workflow_reviews` — Review-Historie (action: approve/approve_with_edits/request_changes/reject/merge/deprecate/precheck).
- `berufs_ki_workflow_merge_candidates` — AI-Duplicate/Merge-Vorschläge.

## RPCs (admin-only via has_role)
- `admin_berufs_ki_list_submissions(p_status)` — Listing inkl. submitter_email + merge_candidate_count.
- `admin_berufs_ki_approve_submission(...)` — promotet Submission → `berufs_ki_workflow_definitions` (kopiert input_schema/output_schema 1:1, schreibt Review-Audit).
- `admin_berufs_ki_review_submission(action, notes)` — request_changes/reject/merge/deprecate.
- `admin_berufs_ki_community_intelligence(window_days)` — JSON KPI: top_categories, top_berufe, avg_quality.

## Edge `berufs-ki-precheck`
- JWT-pflicht, owner-or-admin Gate. Lädt Submission + bestehende Definitionen (gleiche Kategorie, max 40) als Vergleich.
- Lovable AI Gateway tool-call `submit_precheck` → duplicate_score/governance_score/quality_score/recommendation/risk_flags/merge_candidate_ids.
- Setzt Status: governance<30 oder likely_reject → `needs_changes`, sonst `pending_review`. Schreibt precheck JSON + Scores.

## Frontend
- `SubmissionDialog` (auf `/berufs-ki/app` Header) — strukturierte Form, kein Promptblob. Inputs/Outputs zeilenweise → fields/sections; precheck startet automatisch async.
- `BerufsKIReviewPage` (`/admin/berufs-ki/review`) — KPI-Strip + Tabs (pending/precheck/changes/approved/rejected/all) + ReviewDrawer mit Approve/Reject/Merge/Changes + slug+system+user-prompt-Editor für Approve-with-Edits.

## Routes
- Public: keine neue (Submission via Workbench-Button).
- Admin: `/admin/berufs-ki/review` (route-registry + AppRoutes + AdminV2Shell-Nav + ESLint-Allowlist via `/admin/berufs-ki/`-Prefix).

## Bewusst NICHT umgesetzt (offen für Phase 5)
- Auto-Merge-Execution (UI listet candidates, finaler Merge bleibt manuell).
- E-Mail-Notification an Submitter bei Status-Wechsel.
- Public Community-Listing der approved-Workflows (heute schon via `is_active=true` im Katalog sichtbar).
- Auto-Blueprint/Kompetenz-Suggestions Materialisierung (precheck liefert nur Hinweise).
