---
name: Track 2.3 Notification Intelligence
description: Effectiveness-RPC + Anomalie-Klassifikator + Recovery-Lift pro Intent×Kanal×Persona, Diagnose-only (keine Auto-Optimierung).
type: feature
---

# Track 2.3 — Notification Intelligence (Diagnose-only)

## SSOT-RPC
`admin_get_notification_effectiveness(p_window_hours int)` — SECURITY DEFINER + has_role('admin').
Liefert pro (intent_key × channel × persona):
- Counts: sent, opened, cta_clicked, resolved, suppressed
- Rates: open_rate, cta_rate, resolved_rate, ignored_rate, suppression_rate
- Recovery: r_inapp, r_email, r_escalation, r_resolved, recovery_lift_pct
  (lift = jobs mit goal_resolved/cta/open NACH Recovery-Audit / (inapp+email))
- `dead_reminder` boolean (sent≥10 ∧ cta=0)
- `anomaly_flags text[]`: low_open_rate (sent≥20 ∧ open<15%), high_ignored_rate (>85%), low_resolved_rate (<5%), high_recovery_escalation (≥3), over_suppression (>70%), dead_reminder
- `recommendation` text (deterministisch, keine LLM)

## UI
`NotificationEffectivenessCard` im Heal-Cockpit Diagnostics:
- Window-Switch 24h/7d/30d
- KPI-Strip: Sent, Resolved%, Dead Intents, ⌀ Recovery Lift
- Best/Worst Top-3 (n≥5) + Drilldown alle Intents
- Anomaly-Badges + Recommendation-Text pro Zeile

## Guardrails
- **Diagnose-only** — keine automatischen Text/Frequenz/Channel-Mutationen.
- Datenquelle ausschließlich `notification_jobs` + `notification_events` + `notification_recovery_audit`.
- Persona aus `payload->>'persona'` (Fallback 'unknown') — kein neues Schema.
- Keine direkten Client-Reads — Card konsumiert nur RPC.

## Tests
`src/__tests__/notification-effectiveness-track-2-3.test.ts` (8 Tests) — Parity-Mirror der SQL-Klassifikator-Logik (Flags + Recommendation-Pfade).

## Roadmap-Hinweis
Track 2.4 (Adaptive Notification Policy) baut automatische Kanal/Timing/Frequenz-Steuerung AUF dieser RPC auf — Decisions schreiben in `auto_heal_log` + Intent-Registry-Overrides, niemals direkt in Jobs.
