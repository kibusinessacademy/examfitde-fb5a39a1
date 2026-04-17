---
name: D+ Phase 2b Live-Verification Baseline (2026-04-17 19h UTC)
description: Live-Check und Trend-Baseline nach Rollout von Phase 2b (LF-balanced Generator). Verifiziert Wirksamkeit auf MaTSE-Repair-Fall und Sub-Job-Mechanik bei normalen Builds.
type: feature
---

# D+ Phase 2b — Live-Verification Snapshot

## Live-Checks (2026-04-17 19h UTC)

### Check 1: Repair-Fall MaTSE (`0330e463-2dd3-44ff-a86f-2b0e051e3203`)
- 12 LFs in 90 Min bedient, 345 neue Fragen
- Skew-Share dominanter LF: **10.7%** (vorher >40%)
- Bestätigt: gezielter LF-Repair + Phase 2b Anti-Dominanz greifen

### Check 2: Normale Builds — Sub-Job-Mechanik
- Pakete (Destillateur, Bergbautechnologe, Immobilienverwalter) haben Sub-Jobs mit:
  - `learning_field_filter` gesetzt
  - `lf_target_total` 84–250
  - kein `_origin` (= Standard-Build, nicht Repair)
- 100% Skew pro Sub-Job ist **by design** (Sub-Job zielt auf 1 LF)
- Paket-Skew kann erst nach Welle bewertet werden

### Check 3: Trend-Baseline (24h)
- `package_repair_exam_pool_lf_coverage` Jobs: **0** (keine neuen Coverage-Repairs nötig)
- `enqueue_lf_coverage_repair` targeted gen jobs: 12
- Validation-Throughput: 169 completed
- Failed Generations: 9 (low rate)

## Erwartete Trends (24–48h)
- ↓ `REPAIR_LF_COVERAGE_*` Klassifikationen
- ↓ `HARD_FAIL_REPAIR_EXHAUSTED`
- ↓ Pakete mit `lf_skew_max_share > 0.30` nach Build-Abschluss
- → Stabilere `validate_exam_pool` Resultate

## Re-Check Plan
- Snapshot in 24h gegen diese Baseline halten
- Skew-Share aggregiert pro Paket (nicht pro Sub-Job!)
- Falls keine Verbesserung: Generator-Plan-Logik im Detail prüfen

## Status
**Phase 2b ist live und wirksam.** Architektonisch abgeschlossen — nur Trendbeobachtung steht aus.
