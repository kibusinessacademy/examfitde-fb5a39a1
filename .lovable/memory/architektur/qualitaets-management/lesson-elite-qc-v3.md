# Memory: architektur/qualitaets-management/lesson-elite-qc-v3
Updated: 2026-03-29

## Elite Lesson QC v3 — Structural Hard Validators

Die Lesson-QC wurde auf Elite-Niveau gehärtet. Alle 4 Lesson-Steps (Einstieg, Verstehen, Anwenden, Wiederholen) werden durch strukturelle Pflicht-Checks validiert:

### Neue Elite-Regeln (zusätzlich zu bestehenden):

| Step | Neue Regel | Severity |
|------|-----------|----------|
| Einstieg | Mind. 1 konkretes Beispiel | hard_fail |
| Einstieg | Mind. 200 Wörter | hard_fail |
| Verstehen | Mind. 3 markierte Fachbegriffe (<strong>) | hard_fail |
| Verstehen | Mind. 2 Praxisbeispiele | hard_fail |
| Verstehen | Typische Fehler/Denkfehler Pflicht | hard_fail |
| Verstehen | Strukturierung (Headings + Listen) Pflicht | hard_fail |
| Verstehen | Prüfungsbezug empfohlen | soft_warn |
| Anwenden | ⚠️ Prüfungsfalle = hard_fail (war soft_warn) | hard_fail |
| Anwenden | Mind. 250 Wörter | hard_fail |
| Anwenden | Mind. 1 Praxisbeispiel | hard_fail |
| Anwenden | Gestufte Teilaufgaben empfohlen | soft_warn |
| Wiederholen | Mind. 200 Wörter | hard_fail |
| Wiederholen | Mind. 3 Fachbegriffe | hard_fail |
| Wiederholen | Prüfungsfallen/typische Fehler Pflicht | hard_fail |
| Wiederholen | Transferübung empfohlen | soft_warn |

### Prompt-Ebene:
Der System-Prompt in `prompt-builder.ts` enthält nun eine ELITE-PFLICHT-STRUKTUR mit 5 zwingenden Anforderungen an jede generierte Lektion. Dies stellt sicher, dass das LLM bereits bei der Generierung die Elite-Standards erfüllt.

### Wirkung:
Lessons, die diese Regeln nicht erfüllen, erhalten `qc_status = 'tier1_failed'` und werden automatisch zur Regenerierung eingereiht. Die Pipeline-Logik für tier1_failed → regen existiert bereits.
