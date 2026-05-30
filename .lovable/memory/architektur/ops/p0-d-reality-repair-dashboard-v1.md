---
name: P0-D Reality Repair Dashboard v1
description: Single-Sicht /admin/reality-repair. Fetcht statisch public/reality/latest.json + history.json (committed by customer-reality-triage workflow). Zeigt Open P0/P1/P2, Trend 7d/30d, Top-10 Root-Causes, Regressionen, TTR, vollständige Fix-Queue mit first_seen/last_seen.
type: feature
---

# P0-D Reality Repair Dashboard

**Cut:** 2026-05-30
**Frage die beantwortet wird:** "Ist ExamFit besser geworden?"

## Pipeline-Erweiterung

`scripts/customer-reality-triage.mjs` schreibt jetzt **immer** (nicht nur bei RELEASE) zwei statische Files:

- `public/reality/latest.json` — letzte Triage (counts, trend, top_causes, TTR, alle Findings mit first_seen/last_seen)
- `public/reality/history.json` — Append-only Snapshot-Liste (cap 60), enthält fingerprints/new_fps/resolved_fps pro Run

Beide werden vom Workflow `customer-reality-triage` per `git add public/reality/` commited (Schritt "Commit baseline + P0-D dashboard data").

## Reconstructed Metrics

- **first_seen / last_seen** pro Fingerprint aus history.json rekonstruiert
- **TTR** = ø(now − first_seen) für Fingerprints, die im vorigen Snapshot waren und jetzt fehlen
- **Trend 7d / 30d** = ø(total findings) im Window vs. vorheriges gleich-großes Window
- **Regressionen** = Findings, die in mind. einem früheren Snapshot fehlten und jetzt wieder da sind

## UI

Route: `/admin/reality-repair` (Sekundär-Nav `AdminV2Shell.tsx`).
Komponenten: shadcn/ui Card/Table/Badge + inline Sparkline (kein neues Dep).
Refetch: 120s. Manual Refresh Button. Empty/Error State mit Anleitung "Workflow triggern".

## Bewusst nicht gebaut

- Keine DB-Tabelle, kein Edge-Worker, keine RPC
- Kein Auto-Close von Issues (kommt in P0-E)
- Kein Cross-Project-Owner-Notify (Slack/Mail) — manuell aus Dashboard heraus

## Querverweise

- `mem://architektur/ops/customer-reality-triage-loop-v1` (P0-C)
- `mem://architektur/ops/pre-customer-reality-daily-qa-v1` (P0-B)
- `scripts/customer-reality-triage.mjs` (SSOT-Producer)
- `src/pages/admin/v2/RealityRepairPage.tsx` (Consumer)
