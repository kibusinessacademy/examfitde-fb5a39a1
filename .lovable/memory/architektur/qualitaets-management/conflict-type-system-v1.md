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

### Fixes im v1-Generator (`generate-questions/index.ts`)
1. Conflict-Type Distribution (30% Target) mit Random-Assignment
2. Conflict-Hints im Prompt (PFLICHT-Anweisung pro zugewiesener Frage)
3. Output-Mapping: `conflict_type`, `complexity_score`, `scenario_type` — waren komplett fehlend
4. Validierung: Nur gültige conflict_type-Werte werden akzeptiert

### Elite Bug: v1 Generator Missing Columns
Der v1-Generator (`generate-questions`) setzte KEINE der folgenden Elite-v2-Spalten:
- `conflict_type` → jetzt gefixt
- `complexity_score` → jetzt gefixt
- `scenario_type` → jetzt gefixt
- `multi_variable`, `dynamic_scenario`, `transfer_variant` → bleiben v2-only (Blueprint-gesteuert)

### SSOT-Konformität
- `conflict_type` ist ein DB-Feld auf `exam_questions` (kein ENUM-Constraint, String)
- Gültige Werte werden im Generator-Code validiert
- `scenario_type` wird automatisch auf "conflict" gesetzt wenn `conflict_type != 'none'`
