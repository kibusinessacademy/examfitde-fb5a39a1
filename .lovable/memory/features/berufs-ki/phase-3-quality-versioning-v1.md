---
name: Berufs-KI Phase 3 — Quality, Feedback & Versioning
description: Run-Evaluation-Felder, Output-Contract-Guard, Feedback-RPC, Versions-Snapshot-Trigger, Admin Quality Dashboard
type: feature
---

## SSOT
- Tabelle `berufs_ki_workflow_runs` erweitert: quality_score, user_rating (-1/0/1), feedback_text, completion_status (complete|partial|empty|unknown), output_sections_detected[], output_sections_missing[], sections_coverage_pct, definition_version_at_run, source_run_id, follow_up_of.
- Tabelle `berufs_ki_workflow_versions` (Snapshot pro Versionswechsel) — Trigger `trg_berufs_ki_snapshot_version` inkrementiert version + schreibt Snapshot bei relevanter Definition-Änderung. Backfill v1 erfolgt.
- RPC `berufs_ki_record_feedback(run_id, rating, feedback)` — owner-only, validiert rating ∈ {-1,0,1}.
- RPC `admin_berufs_ki_quality_dashboard(window_hours)` — has_role('admin'), liefert OK-Rate, Fehlerquote, Coverage, Latenz, Rating-Score, Lock-Blocked, Lock-Conversions.

## Edge Function `berufs-ki-run`
- Output-Contract-Guard: matched output_schema.sections gegen output_text (case-insensitive, _ → space/-).
- Schreibt sections_detected/missing, coverage_pct, completion_status, quality_score, definition_version_at_run.
- Akzeptiert source_run_id (Rerun) und follow_up_of (Folge-Workflow) im Body.

## Frontend
- `WorkflowRunner.tsx`: Feedback-UI (👍 ➖ 👎 + optional Was hat gefehlt), Copy-Button, Erneut-Ausführen mit source_run_id, Quality-Warning bei partial/empty + Liste fehlender Sektionen, Versions-Badge.
- `BerufsKIQualityPage` (Admin) at `/admin/berufs-ki/quality`: KPI-Strip, Top/Low Workflows, Volltabelle.

## Routes
- `/admin/berufs-ki/quality` (in `route-registry.ts`, `AppRoutes.tsx`, `AdminV2Shell.tsx`-Nav, ESLint-Allowlist greift via `/admin/berufs-ki/`-Prefix).

## Nicht enthalten (offen für Phase 4)
- Pro-Version-Performance-View (Versions-Vergleich) im Admin.
- Gespeicherte Ergebnisse als persistente "Vorlagen" (separate Tabelle).
- Follow-up-Workflow-Auswahl im Runner (UI-Picker).
