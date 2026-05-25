---
name: BK-Monetization-Spine v1 (BK-Act-1 + 1b)
description: SSOT-Härtung des Berufs-KI AI-Entry-Points — Tier-Gate, Cost-Guard, Abuse-Guard, vollständiger Audit-Lifecycle
type: feature
---

# BK-Monetization-Spine v1 — Edge Hardening Completion

**Status:** live (BK-Act-1b geschlossen 2026-05-25)

## SSOT
- **Tier-Gate-Funktion:** `public.fn_workflow_tier_check(_user_id uuid, _workflow_id uuid) → jsonb`
  liefert `{allowed, reason, tier_required, tier_actual, runs_today, daily_limit, workflow_slug, export_allowed, entitlement_snapshot}`.
- **Edge:** `supabase/functions/berufs-ki-run/index.ts` ruft `fn_workflow_tier_check` **vor jedem** AI-Call. Fail-closed bei `gateErr`, `gate.allowed !== true`, unbekanntem Slug oder fehlendem Entitlement.
- **DB-Hard-Gate:** BEFORE-INSERT-Trigger auf `berufs_ki_workflow_runs` (Cut 1) wirft `WORKFLOW_TIER_BLOCKED` falls Edge umgangen wird.

## Cost Guards (server-side, per Tier)
| Tier | promptCharMax | maxOutputTokens | estPromptTokenMax |
|------|---------------|------------------|--------------------|
| free | 12 000        | 800              | 3 500              |
| pro  | 32 000        | 2 500            | 9 000              |
| business | 64 000    | 4 000            | 18 000             |

- Heuristik: `Math.ceil(chars/4)` ≈ Token-Estimate.
- `max_tokens` wird **immer** an den AI-Gateway mitgeschickt.
- Block → HTTP 413 + `workflow_cost_guard_blocked` Audit.

## Abuse / Retry Guards
- **Burst:** ≥ 12 Runs in 60 s pro User → HTTP 429 + `workflow_abuse_guard_blocked` (reason=`burst_limit`).
- **Identical Resubmit:** ≥ 1 Run desselben Workflows in 10 s pro User → HTTP 429 + `workflow_abuse_guard_blocked` (reason=`identical_resubmit`, inputs_hash via djb2).

## Audit-Lifecycle (alle via `fn_emit_audit`)
| action_type | Pflichtschlüssel |
|-------------|------------------|
| `workflow_tier_blocked` | workflow_id, workflow_slug, workflow_tier, blocked_reason, tier_actual, tier_required, runs_today, daily_limit, entitlement_snapshot |
| `workflow_run_granted` | workflow_id, workflow_slug, workflow_tier, usage_bucket, ai_model, runs_today, daily_limit, entitlement_snapshot |
| `workflow_ai_call_attempted` | workflow_id, workflow_slug, workflow_tier, ai_model, estimated_prompt_tokens, estimated_cost_bucket |
| `workflow_ai_call_completed` | workflow_id, workflow_slug, workflow_tier, ai_model, tokens_in, tokens_out, latency_ms, estimated_cost_bucket |
| `workflow_cost_guard_blocked` | workflow_id, workflow_slug, workflow_tier, blocked_reason, estimated_prompt_tokens, prompt_chars |
| `workflow_abuse_guard_blocked` | workflow_id, workflow_slug, workflow_tier, blocked_reason, window_seconds, recent_run_count |

`usage_bucket` / `estimated_cost_bucket` Schema: `xs|s|m|l|xl` basierend auf `estimated_prompt_tokens` Schwellen (1k/3k/8k/16k). Basis für späteres AI-Cost-Accounting (BK-Act-5+).

## Garantie: AI-Call wird bei Block NIE erreicht
Reihenfolge im Edge: **Auth → Workflow-Lookup → Tier-Gate → Input-Validation → Cost-Guard → Abuse-Guard → granted+attempt-Audit → AI-Call**. Jeder Block-Pfad returned bevor `fetch(ai.gateway.lovable.dev)` aufgerufen wird.

## Smoke
`scripts/berufs-ki-edge-hardening-smoke.mjs` — 11 Checks (unknown-fail-closed, free-allowed, pro-blocked, business-blocked, 6 Audit-Contracts, DB-tier-check). **Baseline 2026-05-25: 11/11 grün.**

## Was bewusst NICHT in 1b ist
- Revenue-UX (Upgrade-Walls, Usage-Meter, Locked-Cards) → **BK-Act-2**
- Stripe-Wiring / Add-On-Credits → **BK-Act-3+**
- Graph-Edges / Profession-Contexts in DB → **BK-Act-6**
- `/berufski/*` Legacy-Rückbau → **BK-Act-7**

## Plattform-Wiederverwendbarkeit
`fn_workflow_tier_check` + Audit-Contracts sind generisch genug für: BerufsKI, ComplianceFit, Voice-Agents, AI-Credits, AI-Packs, Usage-Billing, Enterprise-Seats, AI-Cost-Governance.
