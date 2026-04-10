# Memory: architektur/pipeline/validate-exam-pool-pass-first-gate-fix-v1
Updated: 2026-04-10

## Root Cause: HARD_FAIL_REPAIR_EXHAUSTED trotz erfülltem PASS

`fn_classify_exam_pool_gate` prüfte **Repair-Exhaustion VOR Pass-Kriterien**. Wenn 3+ Repair-Snapshots ohne Delta existierten (weil der Pool längst gesund war), wurde HARD_FAIL_REPAIR_EXHAUSTED ausgelöst — obwohl coverage_eligible ≥50, LF ≥80%, Kompetenz ≥70% und unresolved <5%.

## Ursache im Detail

- Alle betroffenen Pakete hatten `tier1_passed_count = 0` (Fragen gingen direkt zu `approved`)
- Die No-Effect-Repair-Detection fand identische Snapshots → `v_no_effect_repairs >= 3`
- Da dieser Check (Zeile 194) VOR dem PASS-Check (Zeile 218) stand, blockierte er terminal

## Fix: PASS-First-Klassifizierung

Neue Reihenfolge in `fn_classify_exam_pool_gate`:
1. HARD_FAIL bei 0 Fragen + keine Generation aktiv
2. **PASS-Check** — wenn fachliche Kriterien erfüllt → sofort PASS, Repair-History irrelevant
3. REPAIR_EXHAUSTED — nur wenn NICHT passing
4. WAITING_FOR_MATERIALIZATION
5. REPAIRABLE (Fallback)

## Betroffene Pakete (11 geheilt)

| Paket | Slug | Vorheriger Status |
|-------|------|-------------------|
| de6c5c13 | bankkaufmann-frau | queued |
| eef4bbe6 | bilanzbuchhalter-ihk | queued |
| 24c3793c | fachinformatiker-anwendungsentwicklung | queued |
| 42bdd4d8 | fachkraft-kurier-express-post | queued |
| fdf4c23c | fachkraft-metalltechnik-montagetechnik | failed |
| 961103c5 | industriemeister-metall-ihk | queued |
| 259894ef | kaufmann-spedition-logistik | failed |
| d14ca583 | kaufmann-versicherungen-finanzanlagen | queued |
| 2e8da39f | mechatroniker-in | queued |
| 62b52784 | pharmazeutisch-kaufm-angestellter | queued |
| 03462382 | wirtschaftsfachwirt-ihk | queued |

## Design-Prinzip

> "Fachliche Pass-Kriterien haben Vorrang vor Repair-Historie. Wenn der Zielzustand erreicht ist, darf keine Zwischenmetrik (tier1_passed_count, Repair-Snapshots) einen HARD_FAIL erzwingen."
