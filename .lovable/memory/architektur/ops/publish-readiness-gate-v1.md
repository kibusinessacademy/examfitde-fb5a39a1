---
name: Publish-Readiness-Gate v1
description: SSOT-Klassifikation für Publish-Readiness via integrity_report.v3.summary.hard_fail_reasons. Coverage ist KEIN Readiness-Signal. View v_publish_readiness_gate + RPCs admin_get_publish_readiness_gate + admin_reconcile_stale_integrity_only. Alte Coverage-RPC deprecated/redirected.
type: feature
---

# Publish-Readiness-Gate v1

**Lehre aus Batch 1 (2026-05-12):** `admin_reconcile_coverage_met_integrity_false` enqueuete 8 Pakete basierend auf `competency_question_coverage_pct ≥ 80`. Ergebnis: 4/8 Erfolg (echte STALE_INTEGRITY), 4/8 Hard-Fail mit `QUALITY_THRESHOLD_NOT_MET` — drei davon mit `TOO_FEW_APPROVED(116-348/500)`, einer mit `HARDISH_TOO_LOW`. Coverage misst Verteilung (jede LF hat Fragen), NICHT absolute Pool-Größe.

## SSOT-Regel

**Coverage ist kein Publish-Readiness-Signal. `integrity_report.v3.summary.hard_fail_reasons` ist die SSOT.**

## Architektur

### View `v_publish_readiness_gate` (service_role + supabase_read_only_user)
Klassifiziert jedes building/queued Paket in genau eine `gate_class`:

| Klasse | Bedingung | Heal-Pfad |
|---|---|---|
| READY | hard_fails=[] AND score≥85 AND integrity_passed=true AND NOT bronze_locked | → Council/Auto-Publish |
| BRONZE_REVIEW_REQUIRED | bronze_locked OR (hard_fails=[] AND score 75–84) | → admin_bronze_tail_auto_unlock / bronze_lock_override |
| STALE_INTEGRITY | hard_fails=[] AND score≥85 AND integrity_passed=false AND no active job | → admin_reconcile_stale_integrity_only |
| POOL_GAP_REPAIR | hard_fail enthält TOO_FEW_APPROVED | → repair_exam_pool_quality (kein Integrity-Retry!) |
| BLOOM_GAP_REPAIR | hard_fail enthält BLOOM_GATE/MISSING_UNDERSTAND/MISSING_EVALUATE | → repair_exam_pool_quality (Bloom) |
| TRAP_GAP_REPAIR | hard_fail enthält TRAP_COVERAGE_BLOCK/HARDISH_TOO_LOW/ELITE_CONTEXT/CONFLICT_TYPE_LOW | → repair_exam_pool_quality (Trap) |
| COUNCIL_PENDING | active package_quality_council job | → warten |
| AUTO_PUBLISH_PENDING | active package_auto_publish job | → warten |
| NEEDS_INTEGRITY_FIRST | kein Report oder score<75 | → run_integrity_check (regulär) |

Precedence: bronze_locked > active tail-job > pool/bloom/trap > score-based.

### RPC `admin_get_publish_readiness_gate(p_class, p_limit)`
SECURITY DEFINER + has_role-Gate. Read-only Klassifikations-Lese.

### RPC `admin_reconcile_stale_integrity_only(p_limit, p_dry_run, p_min_age_hours, p_wip_cap)`
- Eligibility ausschließlich `gate_class='STALE_INTEGRITY'` + `hours_since_integrity ≥ p_min_age_hours` (default 6h)
- WIP-Cap (default 35) gegen system-weite Pending+Processing
- Enqueue: `package_run_integrity_check` mit `bronze_lock_override=true`, `enqueue_source='stale_integrity_reconcile'`
- Audit: `stale_integrity_reconcile_dry_run|enqueued|skipped|summary`

### Deprecated: `admin_reconcile_coverage_met_integrity_false`
Hart umverdrahtet auf neue RPC. Audit `coverage_only_reconcile_deprecated_call`. Returntyp jsonb (war TABLE) — DROP+CREATE war nötig.

## Baseline 2026-05-12 (234 building/queued)

| Klasse | n |
|---|---|
| NEEDS_INTEGRITY_FIRST | 110 |
| BRONZE_REVIEW_REQUIRED | 77 |
| READY | 25 |
| POOL_GAP_REPAIR | 10 |
| COUNCIL_PENDING | 9 |
| TRAP_GAP_REPAIR | 2 |
| AUTO_PUBLISH_PENDING | 1 |
| STALE_INTEGRITY | 0 |

Auffällig: Alle 9 Batch-1-Canaries sind `bronze_locked=true` aus historischem Tagging (siehe Bronze v2). Bronze-Auto-Unlock (memory v4) ist der nächste Heal-Pfad für die Score-100-Pakete.

## Smoke
```sql
SELECT gate_class, COUNT(*) FROM v_publish_readiness_gate GROUP BY 1;
SELECT public.admin_reconcile_stale_integrity_only(10, true, 6.0, 35);
```

## Migrations
- `20260512_v_publish_readiness_gate` — View + getter RPC
- `20260512_admin_reconcile_stale_integrity_only` — RPC v2 + deprecate v1
