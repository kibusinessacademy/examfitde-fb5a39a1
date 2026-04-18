---
name: Upstream Auto-Skip für nicht-applicable package_steps
description: BEFORE-Trigger auf package_steps schreibt nicht-applicable queued Steps direkt zu skipped. Eliminiert ssot_applicability_guard Cancel-Lärm an der Wurzel.
type: feature
---

# Upstream Auto-Skip für nicht-applicable package_steps — 2026-04-18

## Problem
Atomic-Step-Coupling enqueued Jobs für nicht-applicable Steps (z.B. `generate_learning_content` für EXAM_FIRST). Der `job_queue` BEFORE-Guard cancelte sie korrekt mit `cancel_reason='ssot_applicability_guard'`, aber das erzeugte ~132 cancelled Jobs / 2h allein für `generate_learning_content`.

## Fix
SSOT-Helper `fn_is_step_applicable_for_package(package_id, step_key)` nutzt vorhandene Tabelle `track_step_applicability` + `course_packages.track`. BEFORE-Trigger `trg_auto_skip_not_applicable_package_step` auf `package_steps` schreibt nicht-applicable Steps beim Übergang zu `queued` direkt auf `skipped` mit `meta.skip_reason='auto_skipped_not_applicable'`.

## Architektur-Prinzip
Applicability ist eine **Step-Wahrheit**, keine Job-Queue-Wahrheit. Entscheidung gehört vor das Coupling, nicht nach den Job-Insert. Der `job_queue`-Guard bleibt als Defense-in-Depth.

## Backfill
Migration korrigierte ~2.500 fälschlich `queued` stehende nicht-applicable Steps systemweit (EXAM_FIRST: ~308/Step, EXAM_FIRST_PLUS: ~60/Step, STUDIUM: oral_exam/elite_harden, AUSBILDUNG_VOLL: elite_harden) auf `skipped`.

## Erwartete Wirkung
- 132+ `ssot_applicability_guard` Cancels/2h für `generate_learning_content` → ~0
- Atomic-Step-Coupling-Lärm bei EXAM_FIRST/PLUS Pipelines komplett eliminiert
- Build-Lane-Throughput steigt durch entfallene No-Op-Versuche
