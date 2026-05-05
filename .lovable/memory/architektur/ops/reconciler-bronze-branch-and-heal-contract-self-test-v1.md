---
name: Reconciler Bronze-Branch + Heal-Contract Self-Test
description: fn_trg_job_complete_reconcile_step v3 mit Bronze-Branch (badge=bronze + score≥75 + rules_failed≤2 → done+REVIEW_REQUIRED + feature_flags.bronze) statt failed. RPC admin_test_heal_contract(p_package_id) verifiziert DAG-Block + Retry-Pfad TX-isoliert (BEGIN/EXCEPTION + RAISE 'EXAMFIT_ROLLBACK_OK').
type: feature
---

## Problem
5 quality_council Steps standen permanent auf `failed` (Score 78–89 / badge=bronze / 1–2 rules), weil der Reconciler den Bronze-Pfad übersprang. `feature_flags.bronze` blieb NULL → bronze-targeted-repair griff nicht → 1 auto_publish pro Paket dag_blocked → manueller Bypass nötig.

## Fix
**Bronze-Branch im Reconciler v3** (Migration 2026-05-05): Vor Failure-Klassifizierung Check auf `badge='bronze' AND score>=75 AND rules_failed<=2`. Wenn match → `v_ok=true`, `meta.verdict={status:REVIEW_REQUIRED,badge:bronze}`, `meta.bronze_branch=true`, `course_packages.feature_flags.bronze.{repair_active,requires_review,score,rules_failed,set_at,set_by}` gesetzt. Step status='done', kein last_error. Downstream auto_publish bleibt durch `trg_guard_bronze_lock_on_job_enqueue` blockiert (Bronze ≠ Publish-Pass).

## Self-Test RPC
`admin_test_heal_contract(p_package_id uuid)` — admin-only, TX-isoliert via BEGIN/EXCEPTION + `RAISE EXCEPTION 'EXAMFIT_ROLLBACK_OK'` (DB-Rollback, plpgsql-Variablen bleiben). Returnt JSON mit `dag_block.pass` (skipped+jobs_already_running) und `retry.pass` (step→queued + job_queue+1). KEINE persistenten Mutationen.

## Tests
- `src/__tests__/reconciler-bronze-branch.test.ts` (7/7) — Logik-Mirror, Spec-Anker
- `src/__tests__/heal-contract-rpc.integration.test.ts` — env-gated (TEST_ADMIN_JWT + TEST_HEAL_PACKAGE_ID)
- `src/components/admin/heal/cards/HealStatusCard.dag-retry.test.tsx` (7/7) — UI-Vertrag
