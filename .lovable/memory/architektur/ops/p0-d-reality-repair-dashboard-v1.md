---
name: P0-D Reality Repair Dashboard v1 + v2 (Triage Loop Erweiterung)
description: /admin/reality-repair fetcht public/reality/latest.json + history.json (vom customer-reality-triage Workflow commited). Triage erweitert um classification (NEW/RECURRING/REGRESSION_7D/REGRESSION_30D), delta_reason, ETA pro Severity, Route/CTA-Markierung. Issues werden für P0 UND Regressionen auto-geöffnet, Recurrences als Kommentare.
type: feature
---

# P0-D Reality Repair Dashboard (v2)

**Cuts:** 2026-05-30 (v1 Dashboard) + 2026-05-30 (v2 Classification + ETA + Issue-Erweiterung)

## v2-Erweiterung

### Per-Finding Felder (neu in triage.json + public/reality/latest.json)
- `classification` ∈ `NEW` · `RECURRING` · `REGRESSION_7D` · `REGRESSION_30D`
- `delta_reason` — Klartext-Erklärung warum Δ/Regression
- `first_seen_prior` / `last_seen_prior` / `gap_snapshots` / `comparison_window`
- `priority` (=severity) + `eta_hours` (P0=24h · P1=168h · P2=720h) + `eta_due` (ISO)

### Klassifizierungslogik (`classifyDelta`)
- Kein vorheriger Snapshot enthält fp → `NEW`
- fp im letzten Snapshot → `RECURRING`
- fp war früher, dann ≥1 Snapshot sauber, jetzt wieder → Regression
  - Lücke ≤ 7 Tage → `REGRESSION_7D`
  - sonst → `REGRESSION_30D`

### Auto-Issues
- Vorher: nur P0
- Jetzt: P0 **oder** Regression (jeder Severity)
- Labels: `reality`, `p0|p1|p2`, `owner:<key>`, `surface:<…>`, `eta:<n>h`, optional `regression` + `regression_7d|30d`
- Dedupe: Open Issues mit `reality` Label, Fingerprint im Body → bestehendes Issue bekommt **Recurrence-Kommentar** mit aktueller Classification statt Duplikat

### Dashboard UI
- Pro Finding-Row: Δ-Badge (NEW/RECURRING/REG-7d/REG-30d), Δ-Begründung (Tooltip + Inline), ETA-Spalte mit due-Hint, Route/CTA als Mono-Chip
- Zwei dedizierte Regression-Cards (7d / 30d) zeigen Severity + Class + Route + delta_reason
- Trend-KPI behält Δ/new/resolved; report.md zeigt `regressions_7d` / `regressions_30d`

## Pipeline (unverändert)

1. `learner-reality-daily.yml` → results + findings
2. `pre-customer-reality-daily.yml` → results + findings
3. `customer-reality-triage.yml` → triage + Issues + public/reality + Baseline-bei-RELEASE

## Querverweise
- `mem://architektur/ops/customer-reality-triage-loop-v1`
- `scripts/customer-reality-triage.mjs` (SSOT-Producer)
- `src/pages/admin/v2/RealityRepairPage.tsx` (Consumer)
