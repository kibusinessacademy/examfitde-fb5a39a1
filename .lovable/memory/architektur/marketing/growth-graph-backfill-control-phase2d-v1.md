---
name: Phase 2D Growth Graph Backfill Control
description: Read+Action UI in GrowthGraphLeitstelleCard für Preview / Dry Run 50 / Real Run 50 mit Confirm-Dialog
type: feature
---
# Phase 2D Growth Graph Backfill Control

## UI
- Komponente `GrowthGraphBackfillControl` (in `GrowthGraphLeitstelleCard` integriert).
- Preview via `admin_preview_content_graph_backfill` (auto + manueller Refetch).
- Dry Run 50 via `admin_run_content_graph_backfill(50, true)` — kein Write.
- Real Run 50 nur möglich, wenn Dry-Run-Ergebnis vorliegt; AlertDialog-Confirm Pflicht.
- Nach Real Run: invalidate `growth-graph-summary`, `growth-graph-orphans`, `growth-graph-backfill-preview`. Toast mit inserted/skipped/invalid.

## Hard Constraints
- Kein „Run All" Button (Limit hart 50).
- Kein Edge-Backfill, kein Auto-Heal, kein Cron.
- Kein direkter Tabellenzugriff — nur RPCs (admin_*).
- Pending-State disabled alle Buttons.
- Error-State mit Retry.

## Audit
- Jeder Run loggt in `auto_heal_log` (action_type=`growth_content_graph_backfill`, dry_run-Flag, per_source-Counts).

## Notes
- SQL-Verifikation Phase 2C: `SELECT * FROM blog UNION ALL …` ist korrekt (Chat-Renderer hatte den `*` visuell unterdrückt).
