---
name: ConversationOS Phase 2 Cut D — Mastery & Progression UI
description: History-Page um Mastery-Tier-System (Bronze/Silber/Gold), Trend-Indikatoren, Painpoint-Mastery, Streak, Zertifikate und Empfehlungs-Engine erweitert
type: feature
---

# Cut D: Mastery & Progression UI (Frontend-only)

**Datum**: 2026-05-27
**Scope**: Pure Frontend-Aggregation auf bestehenden Daten (sessions, debriefs, scenarios). Keine neuen DB-Felder.

## Komponenten in ConversationOSHistoryPage

1. **Tier-System**: Gold ≥88, Silber ≥75, Bronze ≥60, Lernend <60. Helper `tierFor(score)`.
2. **Overall-Header**: Tier · Sessions completed/total · Streak (consecutive ≥70) · Zertifikate-Count (debrief.certificate_eligible=true).
3. **Empfehlungs-Engine**: Wählt unplayed scenario, sortiert nach Schwierigkeit gegen overall (≥85→hard, ≥70→medium, sonst easy). Begründung mit schwächster Rubric-Dimension.
4. **Mastery pro Dimension**: Tier-Icon + Trend (last3 vs prev3 avg, ±2pts) + Progress.
5. **Painpoint-Mastery**: Aggregiert `painpoint_activation_counts` × `total_score` pro Session, schwächste zuerst (Top 8). Verzichtet auf neue RPC.
6. **Sessions-Liste**: Tier-Icon pro Session neben Score.

## Bewusst nicht gebaut

- Kein DB-View für Mastery-Aggregation (sessions-Limit 50 reicht, client-side schnell).
- Keine separate Mastery-Tabelle (rubric_scores in conversation_os_sessions ist SSOT).
- Kein Certificate-Issuance-Flow (nur Counter — Issue-Flow ist Cut E/F).

## Verifikation
TypeScript-Build clean, alle Imports aus shadcn/lucide vorhanden. Daten-Pfade: sessions.rubric_scores, sessions.painpoint_activation_counts, sessions.total_score, debriefs.certificate_eligible.
