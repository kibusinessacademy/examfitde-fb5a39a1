---
name: P20 Cut 0C — Platform Conscience Hub v1
description: /admin/platform-conscience bündelt P18, GIL und AI Runtime read-only über admin_get_platform_conscience_summary
type: feature
---

# P20 Cut 0C — Unified Platform Conscience Hub

## Route
- `/admin/platform-conscience` → `src/pages/admin/PlatformConsciencePage.tsx`
- Top-Nav-Eintrag `Conscience` (Icon `Sparkles`) — sichtbar zwischen `Cockpit` und `Leitstelle`.

## Säulen (read-only)
1. **Architecture Governance / P18** → `/admin/governance/architecture`
   - KPIs: open_drifts, blocked, healed, rejected
   - Last activity: jüngster Ledger-Eintrag aus `p18_idempotency_ledger`
2. **Growth Intelligence / P19** → `/admin/growth-intelligence`
   - KPIs: market_signals_total, internal_drift_signals, open_recommendations, critical_signals
   - Last activity: letzte Briefing-Headline aus `gil_growth_briefings`
3. **AI Runtime Center** → `/admin/runtime`
   - KPIs: ai_runs_total, failed_7d, succeeded_7d, active_policy_versions
   - Last activity: letzter AI-Eval-Run aus `ai_eval_runs`

## SSOT-RPC
- `admin_get_platform_conscience_summary()` — SECURITY DEFINER, `has_role(admin)` Gate
- Liest **nur** existierende Tabellen: `p18_idempotency_ledger`, `gil_market_signals`, `gil_growth_briefings`, `ai_eval_runs`, `policy_versions`
- Keine Mutation. Keine neue Tabelle. Keine neue Queue. Keine neue Audit-Struktur.

## Scope
- Read-only. Keine Heal-/Briefing-/Signal-Buttons im Hub.
- Nur Status + Deep-Link-Navigation. Empty/Loading/Error States vorhanden.
- Keine Raw Payloads. Keine Secrets. Keine Direkt-Table-Reads im Client.

## Tests
- `src/pages/admin/__tests__/PlatformConsciencePage.test.tsx` (4 Tests)
  - Alle 3 Säulen sichtbar + Deep-Links korrekt
  - KPIs werden aus RPC gerendert
  - Read-only: keine `<button>`-Elemente im Hub
  - Error-State bei RPC-Fehler

## Rollback
- Route + Nav-Eintrag entfernen, Page-Datei löschen, RPC `admin_get_platform_conscience_summary` droppen. Keine weiteren DB-Änderungen.
