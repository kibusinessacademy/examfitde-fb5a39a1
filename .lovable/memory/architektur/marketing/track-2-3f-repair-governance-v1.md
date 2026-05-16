---
name: Track 2.3f Outcome-based Repair Governance v1
description: growth_repair_strategy_state (PK signal,canonical_job_type) + v_growth_repair_strategy_health_v1 (14d window, trust_score 0-100). _growth_repair_recompute_strategy_governance entscheidet block/downrank/tune/trust/observe pro Strategie. _growth_repair_decide blockt GOVERNANCE_BLOCKED + verdoppelt Cooldown bei downranked. Manuelle Overrides bleiben erhalten. Cron stündlich.
type: feature
---

# Track 2.3f — Outcome-based Repair Governance (2026-05-16)

## Zweck
Track 2.3e beweist Wirkung pro Attempt. 2.3f schließt den Loop, indem es **pro Strategie** (signal × canonical_job_type) entscheidet, ob künftige Repairs überhaupt dispatcht werden dürfen. Damit wird "Outcome" zum Steuer-Input statt nur zum Report.

## Schema

### `growth_repair_strategy_state` (service_role only)
- PK `(signal, canonical_job_type)`
- `governance_state`: `active` | `downranked` | `blocked` (CHECK)
- `recommendation`: `trust` | `observe` | `tune` | `downrank` | `block` (vom Recompute geschrieben)
- `trust_score numeric` (0–100)
- `metrics jsonb` (Snapshot der letzten v_health-Zeile)
- `manual_override boolean` + `override_reason` + `override_by uuid`
- `last_recomputed_at`, `state_changed_at`

### `v_growth_repair_strategy_health_v1` (service_role only)
14d-Window auf `growth_repair_outcomes` joined auf `growth_repair_job_type_map`. Pro (signal, canonical_job_type):
- counts: total / pending / closed / failed / stale / abandoned / verified
- rates: close_rate_pct / fail_rate_pct / stale_rate_pct / abandoned_rate_pct
- `avg_close_minutes`
- `trust_score = clamp(0..100, (closed*100 - failed*80 - abandoned*90 - stale*30) / verified)`

## Recompute-Logik (`_growth_repair_recompute_strategy_governance`)
Deterministische Leiter:
1. verified ≥ 5 AND fail_rate ≥ 60% → **block**
2. verified ≥ 5 AND abandoned_rate ≥ 50% → **block**
3. verified ≥ 5 AND close_rate < 30% → **downrank**
4. verified ≥ 5 AND stale_rate ≥ 50% → **tune** (state bleibt active, Recommendation als Signal an Ops)
5. verified ≥ 10 AND close_rate ≥ 80% → **trust** (state bleibt active)
6. sonst → **observe** (active)

State-Mapping: `block→blocked`, `downrank→downranked`, sonst `active`.

**Manual-Override-Schutz**: wenn `manual_override=true`, werden NUR metrics + recommendation + trust_score aktualisiert — `governance_state` bleibt unverändert.

State-Wechsel werden in `auto_heal_log` action_type=`growth_repair_strategy_state_changed` geloggt (alter+neuer State, metrics). Run-Summary `growth_repair_governance_recompute`.

## Enforcement (`_growth_repair_decide`)
Nach Mapping-Resolution + Registry-Check + VOR active-job-canonical-check:
- Lookup `growth_repair_strategy_state` für (signal, canonical_job_type)
- `blocked` → skip mit `GOVERNANCE_BLOCKED` (+ recommendation, trust_score im result)
- `downranked` → Cooldown × 2 (Standard 60min → 120min)
- `active` (oder Row fehlt) → unverändert

Dispatch-Result enthält jetzt zusätzlich `governance_state` für Observability.

## Admin RPCs (has_role-Gate)
- `admin_growth_repair_strategy_health()` — Aggregat + Strategien-Tabelle (sortiert blocked → downranked → total desc) + recent_events (15)
- `admin_set_growth_repair_strategy_override(_signal,_canonical_job_type,_state,_reason,_manual=true)` — Reason ≥3 Pflicht, Audit `growth_repair_strategy_state_overridden`
- `admin_recompute_growth_repair_governance(_reason)` — Reason ≥3 Pflicht

## Cron
- `growth-repair-governance-hourly` — `23 * * * *` → `_growth_repair_recompute_strategy_governance('cron: hourly recompute', NULL, 'cron_growth_repair_governance_hourly')`
- Initial Seed-Run direkt nach Migration (0 Outcomes vorhanden → seen=0, korrekt).

## UI
`GrowthClassificationCard` → neue Sektion **Repair Governance · Track 2.3f** (unter Repair Outcome Verification):
- KPI-Strip 5×: Strategies / Active / Downranked / Blocked / Manual
- Tabelle pro Strategie: Signal/Job · N · close% · fail% · stale% · trust · Rec-Pill · State-Pill (+ "manual" Badge) · override-Button
- Recent governance events (6) inkl. old→new
- Recompute-Button (Reason-Prompt)

## Invarianten
- KEINE Mutation von customer_safe, course_packages.status, Entitlements, Sellability
- Outcomes-Tabelle bleibt SSOT — Governance ist nur Lese-Aggregator + Strategy-State
- Manual-Override gewinnt immer gegen automatische Recompute-State-Mutation
- Cooldown-Verdopplung wirkt nur pro Strategie, nicht global
- `blocked` blockt nur künftige Dispatches — laufende Jobs werden NIE gecancelt
- View+Tabelle service_role only, Frontend nur via RPC

## Baseline 2026-05-16
- Seed-Recompute: seen=0 (noch keine verified Outcomes — 2.3e wartet auf neue Dispatches nach Cooldown)
- Erwartete erste echte Recompute-Wave in 24–48h, sobald `growth-repair-verifier-15min` Outcomes auf signal_closed/job_failed gesetzt hat
- Erwartete Verteilung im FANOUT_NOT_STARTED-Pilot: ~70% active, ~20% trust, ~10% tune; block/downrank nur bei echten Producer-Defekten

## Nächster Schritt
2.3g — Governance Replay Notifier: bei `state_changed_at` → blocked, automatisch `heal_alert_notifications` triggern (Slack/Email) + Producer-Owner aus `ops_job_type_registry.owner` ableiten. Verhindert, dass kaputte Strategien still gesetzt werden ohne dass jemand schaut.
