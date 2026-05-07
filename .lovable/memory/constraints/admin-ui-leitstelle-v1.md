---
name: Admin UI Leitstelle v1
description: Admin-Cards sind Leitstellen, keine Daten-Tabellen. Pflicht-Props Status+Severity+RootCause+Action+Audit+Trend+Drilldown. Mutationen nur mit Reason+auto_heal_log+Toast+invalidateQueries.
type: constraint
---

# Admin UI = Leitstelle

## Pflicht-Anatomie jeder Admin-Card
1. **Status-Badge** (OK / WARN / CRIT)
2. **Severity** P0 / P1 / P2 / OK (sortierbar)
3. **Root-Cause-Hint** (1 Satz, was ist der Auslöser)
4. **Betroffene Pakete** (Count + Drilldown-Link)
5. **Last Action** (Timestamp + Audit-Link `auto_heal_log`)
6. **Recommended Next Action** (Primary CTA, sicher)
7. **Trend** 24h / 7d (Delta oder Mini-Spark)
8. **Rollback-Hint** wenn destruktiv

## Mutation-Regel
Jede destruktive/state-changing Aktion:
- Confirmation-Dialog mit **Reason-Pflichtfeld**
- Insert in `auto_heal_log` mit `action_type`, `target_id`, `actor_uid`, `reason`
- Toast (success / error)
- `queryClient.invalidateQueries()` der betroffenen Keys
- Result-Anzeige in der Card (nicht nur Toast)

## Verboten
- Reine `<table>` ohne Entscheidungslogik
- Direct client `from('xxx')` auf SSOT-Tables — nur SECURITY DEFINER RPC + `has_role`
- Mutationen ohne Reason
- Buttons ohne Disabled-State während Pending
- Generic „Loading..." ohne Skeleton-Layout

## Datenzugriff
- TanStack Query mit sinnvoller `staleTime` (>=30s) und `refetchInterval` (60–120s) für Cockpit-Cards
- Realtime-Subscription nur wenn echter Bedarf, sonst Polling
- Fehlerzustand IMMER mit Retry-Button + technischem Detail (collapsed)

## Pre-Brief Pflicht (vor neuer Admin-Card)
- Welche Entscheidung trifft der Admin?
- Was ist die sichere Default-Aktion?
- Welche Aktion ist gefährlich (Audit-Pflicht)?
- Wie misst man, ob die Aktion gewirkt hat?

## Querverweise
- `mem://constraints/growth-os-framework-v1`
- `docs/GROWTH_OPERATING_SYSTEM.md` §3
- bestehende Best-Practice-Cards: `HealStatusCard`, `DagBlockedDashboardCard`, `StuckPatternsCard`
