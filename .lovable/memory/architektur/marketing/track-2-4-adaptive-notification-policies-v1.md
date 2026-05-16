---
name: Track 2.4 Adaptive Notification Policies
description: Deterministic adaptive policy layer with safety_class floors, hysteresis, cooldown and explainable reasons. No autonomous growth-hacking.
type: feature
---

# Track 2.4: Adaptive Notification Policies (v1)

## Ziel
Aus Effectiveness-Diagnose (2.3) wird ein kontrollierter, deterministischer Governance-Layer, der den minimal nötigen, wirksamsten Interventionstyp pro intent×persona×channel wählt.

## Architektur
- **notification_intent_registry**: erweitert um `safety_class` (standard|sensitive|critical) + `min_delivery_floor` (none|neutral|prefer).
  - critical: `exam_countdown`, `payment_reminder`, `support_reply`
  - sensitive: `weak_competency_drill`, `course_resumption`
- **notification_adaptive_policies** (SSOT): aktueller Zustand pro (intent_key, persona, channel) mit `strategy`, `pending_strategy`, `consecutive_proposals`, `active_since`, `cooldown_until`.
- **notification_policy_decisions**: append-only Audit jedes Recompute-Vorschlags inkl. `metrics`, `reasons`, `guard_action`.

## Strategien
`prefer | neutral | downrank | cooldown | suppress`

## Engine (admin_recompute_adaptive_policies)
Deterministische Klassifikation pro Zeile aus `admin_get_notification_effectiveness`:
1. `sent < min_sample (30)` → neutral (insufficient_sample)
2. `dead_reminder` → downrank
3. `high_recovery_escalation` → cooldown
4. `open_rate < 0.15` AND alt-channel resolved > self → downrank (low_open_rate + channel_X_outperforms)
5. `resolved_rate ≥ 0.40` AND `open_rate ≥ 0.35` → prefer
6. `low_resolved_rate` flag → downrank
7. sonst neutral

### Guardrails
- **Safety-Clamp**: critical → niemals downrank/cooldown/suppress (geclampt auf neutral oder prefer je min_delivery_floor). sensitive → kein suppress.
- **Hysteresis**: Strategy-Flip erst nach `p_hysteresis (default 2)` aufeinanderfolgenden gleichen Proposals.
- **Cooldown**: nach Flip 24h gesperrt für weitere Änderungen — verhindert Notification-Flapping.
- **Idempotent dry-run** (default true): Vorschau ohne Mutation.

## Resolver (service_role)
`resolve_notification_policy(intent_key, persona, channel) → jsonb` mit Defense-in-Depth Safety-Floor. Persona-Fallback auf 'all'. Suppress wenn intent disabled.

## UI
`AdaptivePolicyCard` im HealCockpit (nach Effectiveness): Window-Switch (24h/7d/30d), Dry-Run/Apply, Tabs Active/Preview/History mit Reasons + guard_action.

## Was bewusst NICHT gebaut wurde
- RL / Multi-Armed Bandit
- GPT-generierte Policy-Entscheidungen
- Autonome Kanalwahl ohne Audit
→ Begründung: EU-AI-Act, Auditierbarkeit, Trust. Erst nach 2.4-Reife evaluieren.

## Files
- migrations/20260516_track_2_4_adaptive_policies.sql (siehe Branch-Migration)
- src/components/admin/heal/cards/AdaptivePolicyCard.tsx
- src/__tests__/adaptive-policy-track-2-4.test.ts (TS-Klassifikator-Parität)
