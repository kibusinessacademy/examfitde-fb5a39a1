---
name: Council-Worker Time-Budget + Chunked Promotion v3
description: Permanent-Fix für package-quality-council CPU-Loop. Time-Budget (25s soft / 60% defer-threshold), 200er Promotion-Chunks (war 2000 in einem Call), idempotenter Resume via payload.resume_state mit cached_verdict. 5 Phasen (gate→reclassify→promote→audit→finalize). Defer re-enqueued mit run_after+30s. Audit action_type='council_time_budget_deferred'.
type: feature
---

## Problem (2026-05-01)
53 Pakete in einem 6h-Fenster im Council-CPU-Loop:
- ≥50 approved questions, integrity score 100, 0 drafts
- Worker stirbt im STALE_LOCK (Edge-Function CPU-Limit), kein Application-Error
- MAX_ATTEMPTS_EXHAUSTED nach 4 Cycles × 2 Reaper-Runden
- Pakete blockierten auto_publish-Pipeline

Root Cause: `promote_exam_questions_from_council` mit `p_limit=2000` in **einem** RPC-Call + Trigger-Kaskade auf exam_questions (qc_status sync, audit, mat-views) übersteigt das Edge-Function CPU-Quota bei großen Curricula (>400 Fragen).

## Fix (v3 — package-quality-council/index.ts)

### Time-Budget
```ts
const TIME_BUDGET_MS = 25_000;
const TIME_BUDGET_SOFT_PCT = 0.6;  // defer at 60% wall clock
class TimeBudget {
  shouldDefer(): boolean { return this.elapsed() > this.budgetMs * this.softPct; }
}
```

### Chunked Promotion
- `PROMOTION_CHUNK_SIZE = 200` (war 2000)
- `MAX_CHUNKS_PER_INVOCATION = 6` (max 1200 promoted pro Call)
- Loop bricht ab bei `shouldDefer()` ODER bei `promotedThisChunk < CHUNK_SIZE` (no more drafts)

### Idempotenter Resume
Payload-Schema bei Defer:
```ts
payload: {
  package_id,
  step_key: "quality_council",
  resume_state: {
    phase: "gate" | "reclassify" | "promote" | "audit" | "finalize",
    promoted_so_far: number,
    reclassify_done: boolean,
    audit_done: boolean,
    cached_verdict: { score, status, badge, ... }   // gate verdict gecacht!
  },
  deferred_from: <prev job_id>
}
```
Re-enqueue via `enqueueJob` mit `run_after = now+30s, max_attempts: 8`.

### 5 Phasen (mit Resume-Skip)
1. **gate** — Rules evaluieren, Reports persistieren. Bei resume → cached_verdict laden.
2. **reclassify** — case_study/transfer cognitive_level fixen (best-effort, time-checked).
3. **promote** — Chunked Loop mit Time + MaxChunks Guard.
4. **audit** — Elite-LF-Audit (skipped bei Time-Pressure, non-blocking).
5. **finalize** — markStepDone + council_approved=true.

### Audit
- `auto_heal_log.action_type = 'council_time_budget_deferred'`
- metadata: phase, promoted_so_far, reclassify_done, elapsed_ms, reason

## Invarianten
- Worker MUSS bei großen Paketen (≥400 Fragen) in maximal 3 Defer-Cycles fertig werden
- Defer ist **niemals** Fail — re-enqueue + 202-Status
- Cached-Verdict bleibt stabil über Resume-Cycles (gate wird nur einmal evaluiert)
- markStepDone nur in `finalize`-Phase nach erfolgreicher Promotion

## Komplementär zu
- `tail-step-artifact-aware-defer-v1` (verhindert Block durch defer)
- `lane-health-rpc-and-reap-loop-guard-v1` (Reaper hard-failt nach 2 Cycles, aber Defer-Pattern verhindert dass es überhaupt zum Reap kommt)
- `Tail-Step-Schutz` (Core memory): Pakete mit approved questions werden nie geblockt
