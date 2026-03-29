# Memory: architektur/qualitaets-management/conflict-type-system-v1
Updated: 2026-03-29

## Conflict-Type System — Elite-Härtung für Prüfungsrealität

### Problem
Alle Fragen waren "zu eindeutig". Echte IHK-Prüfungen enthalten Konflikt-Fragen, bei denen mehrere Antworten plausibel erscheinen und nur feine Unterschiede die richtige Wahl bestimmen.

### Lösung
`conflict_type` Spalte existierte bereits in `exam_questions` — wurde aber nur vom v2-Generator befüllt, vom v1-Generator (`generate-questions`) komplett ignoriert.

### Conflict-Typen (ENUM-Werte)
| Typ | Beschreibung |
|-----|-------------|
| `none` | Standard-Frage ohne Konflikt |
| `similar_options` | 2+ Antworten klingen fast identisch, feiner Unterschied entscheidet |
| `legal_vs_practical` | Rechtlich korrekt vs. Praxisüblich — Prüfling muss Recht wählen |
| `best_answer` | Mehrere teilweise richtige Antworten, nur eine ist die BESTE |
| `priority_conflict` | Mehrere richtige Maßnahmen, Priorität/Reihenfolge entscheidet |

### Verteilungs-Target
- **30% aller generierten Fragen** müssen `conflict_type != 'none'` haben
- Distribution wird per Random-Sampling im Generator zugewiesen
- LLM-Output wird validiert und mit Assignment abgeglichen

### Systemweite Integration (v1.1)
1. **v1-Generator** (`generate-questions/index.ts`): Conflict-Type Distribution + Prompt-Hints ✅
2. **v2-Generator** (`auto-generate-question-v2/index.ts`): Hatte bereits conflict_type ✅
3. **Elite-Annotation** (`elite-annotation.ts`): `conflict_type` als Input-Feld + Score-Bonus (+2) ✅
4. **Elite-Harden** (`package-elite-harden/index.ts`): Query enthält `conflict_type` in beiden Phasen ✅
5. **Integrity-Check** (`package-run-integrity-check/index.ts`): Neues GATE 10c `conflict_type_distribution` ✅
6. **Export** (`export-course-package/index.ts`): Bereits enthalten ✅

### Integrity Gate 10c: conflict_type_distribution
| Track | Min-Target |
|-------|-----------|
| `AUSBILDUNG_VOLL` | 15% |
| `ELITE` | 20% |
| `EXAM_FIRST` | 10% |

- Severity: `warning` (nicht blocker — System baut sich über Zeit auf)
- Excellence: ≥25% → `CONFLICT_TYPE_EXCELLENT`
- Auto-Repair: `CONFLICT_TYPE_LOW` Signal triggert metadata repair pipeline

### Elite-Score Bonus
Fragen mit `conflict_type != 'none'` erhalten **+2 Elite-Score-Punkte** in der Annotation.
Dies hebt Konflikt-Fragen automatisch Richtung `advanced` oder `elite` Level.

### SSOT-Konformität
- `conflict_type` ist ein DB-Feld auf `exam_questions` (kein ENUM-Constraint, String)
- Gültige Werte werden im Generator-Code validiert
- `scenario_type` wird automatisch auf "conflict" gesetzt wenn `conflict_type != 'none'`
