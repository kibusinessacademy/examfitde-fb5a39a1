---
name: Growth Quality Auto-Improvement Foundation v1
description: Welle 5 Foundation — zentrale Repair-Architektur (Modul-Registry + Pre/Post-Score-Gate + Council-Gate ≥75), keine Module-Implementierung
type: feature
---

## Scope (User-Approval 2026-05-11)
- **Foundation only** — keine Module-Repair-Worker. Module folgen pro Loop.
- **Quality-Gate**: Pre/Post-Score-Diff (post < pre → Rollback) + Council ≥75 für AI-Generative Module.
- **Trigger**: bestehender 5-Min-Worker `growth-quality-repair-worker` wird später erweitert.

## Schema
- `public.growth_repair_modules` (subscore PK, job_type, generator_kind, requires_council, requires_pre_post_score, enabled, config jsonb, description) — RLS on, service_role only. Seed: 8 Module, alle disabled.
- `public.growth_repair_runs` (id, package_id, subscore, job_id, status [pending|running|gate_pre|generating|gate_post|council|completed|failed|rolled_back], pre_score, post_score, score_delta GENERATED, council_verdict, council_score, artifact_ref, rollback_info, error, started_at, completed_at).

## Functions (service_role)
- `fn_growth_repair_start_run(package_id, subscore, job_id?)` → snapshots pre_score via `fn_compute_growth_quality_score`, returns run_id, audit `growth_repair_run_started`.
- `fn_growth_repair_complete_run(run_id, artifact_ref?, council_verdict?, council_score?, error?)` → computes post_score, applies Gate (post<pre OR council<75 OR verdict not in PASS|REVIEW_REQUIRED → rolled_back), audit `growth_repair_run_completed` mit `gate_pass`+`gate_reasons`.
- `fn_growth_repair_rollback(run_id, reason)` → manual rollback, audit `growth_repair_run_rolled_back`.

## Admin RPCs (has_role gated)
- `admin_get_growth_repair_modules()` — Registry-Liste.
- `admin_set_growth_repair_module_enabled(subscore, enabled)` — Toggle, audit `growth_repair_module_toggle`.
- `admin_get_growth_repair_runs(limit)` — letzte Runs.
- `admin_rollback_growth_repair_run(run_id, reason)` — UI-Rollback (Reason-Pflicht ≥3 Zeichen).

## Audit-Trail (auto_heal_log)
- `growth_repair_run_started` · started
- `growth_repair_run_completed` · completed | rolled_back | failed
- `growth_repair_run_rolled_back` · rolled_back
- `growth_repair_module_toggle` · enabled | disabled

## UI
- `GrowthRepairFoundationCard` im Tab `fanout` der GrowthPage (unter `GrowthQualityScoreCard`).
- Module-Registry mit Toggle pro Subscore, Recent Runs (25) mit Pre/Post/Δ/Council, Per-Run-Rollback-Button mit Reason-Prompt.

## Status
- Foundation live, alle 8 Module disabled.
- Module-Worker-Implementierung folgt pro Loop (User-Entscheidung pro Modul).
