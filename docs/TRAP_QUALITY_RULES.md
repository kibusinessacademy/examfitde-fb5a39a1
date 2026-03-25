# Trap Quality Rules — SSOT

> **Version:** 1.0  
> **Status:** Verbindlich  
> **Scope:** Alle exam_questions mit status = 'approved'

---

## 1. Zweck

Dieses Dokument definiert die **Soll-Verteilung** der `trap_type`-Werte im Prüfungsfragen-Pool.  
Es dient als SSOT für:
- Anomalie-Erkennung (Audit)
- Ampellogik (Leitstelle)
- Blueprint-Validierung
- Auto-Rebalancing

---

## 2. Trap-Typen (Taxonomie)

| trap_type           | Beschreibung                                          |
|---------------------|-------------------------------------------------------|
| `misconception`     | Häufiger fachlicher Irrtum, falsche Grundannahme      |
| `typical_error`     | Typischer Anwendungsfehler im Berufsalltag            |
| `calculation_trap`  | Rechenfehler, Einheitenverwechslung, Formelfehler     |

> Erweiterung um weitere Typen ist möglich, erfolgt aber nur bei nachgewiesenem didaktischem Bedarf.

---

## 3. Curriculum-Profile

Jedes Curriculum wird einem **Profil** zugeordnet, das die erwartete Trap-Verteilung steuert.

| Profil              | Beschreibung                                          | Beispiele                                     |
|---------------------|-------------------------------------------------------|-----------------------------------------------|
| `calculation_heavy` | Rechenlastig, Formeln, Kennzahlen, Kalkulation        | Steuerfachangestellte, Industriemechaniker    |
| `procedure_heavy`   | Prozesse, Abläufe, Regelwerk, Vorschriften             | SoVFa, Verwaltungsfachangestellte             |
| `concept_heavy`     | Theorie, Definitionen, Zuordnungen                     | Fachinformatiker, Biologielaborant            |
| `mixed`             | Ausgewogene Mischung aller Bereiche                    | Elektroniker, Mechatroniker, Default          |

---

## 4. Zielkorridore pro Profil

### 4.1 Track: AUSBILDUNG_VOLL

#### Profil: `mixed` (Default)

| trap_type          | target_pct | min_pct | max_pct | warn_below | hard_below |
|--------------------|-----------|---------|---------|------------|------------|
| misconception      | 35        | 25      | 45      | 20         | 15         |
| typical_error      | 40        | 30      | 50      | 25         | 20         |
| calculation_trap   | 25        | 15      | 35      | 10         | 5          |

#### Profil: `calculation_heavy`

| trap_type          | target_pct | min_pct | max_pct | warn_below | hard_below |
|--------------------|-----------|---------|---------|------------|------------|
| misconception      | 25        | 15      | 35      | 12         | 8          |
| typical_error      | 30        | 20      | 40      | 15         | 10         |
| calculation_trap   | 45        | 35      | 55      | 30         | 25         |

#### Profil: `procedure_heavy`

| trap_type          | target_pct | min_pct | max_pct | warn_below | hard_below |
|--------------------|-----------|---------|---------|------------|------------|
| misconception      | 30        | 20      | 40      | 15         | 10         |
| typical_error      | 50        | 40      | 60      | 35         | 30         |
| calculation_trap   | 20        | 10      | 30      | 8          | 5          |

#### Profil: `concept_heavy`

| trap_type          | target_pct | min_pct | max_pct | warn_below | hard_below |
|--------------------|-----------|---------|---------|------------|------------|
| misconception      | 45        | 35      | 55      | 30         | 25         |
| typical_error      | 35        | 25      | 45      | 20         | 15         |
| calculation_trap   | 20        | 10      | 30      | 8          | 5          |

### 4.2 Track: EXAM_FIRST

Exam-First nutzt die gleichen Profile, aber mit **engeren Korridoren** (±5% statt ±10%):

| Anpassung        | Wert                     |
|-------------------|--------------------------|
| min_pct           | target_pct − 5           |
| max_pct           | target_pct + 5           |
| warn_below        | target_pct − 10          |
| hard_below        | target_pct − 15          |

---

## 5. Override-Hierarchie

Priorität (höchste zuerst):

1. **Blueprint-Regel** — Individueller Blueprint definiert erwarteten trap_type
2. **Curriculum-Regel** — Curriculum-spezifischer Override in `trap_distribution_rules`
3. **Track-Default** — Profil-basierter Default aus der Konfigurationstabelle

Der Resolver prüft in dieser Reihenfolge und nimmt die erste verfügbare Regel.

---

## 6. Bloom-Korrelation (Empfehlung)

Keine harte Regel, aber didaktische Erwartung:

| Bloom-Level          | Erwarteter Schwerpunkt       |
|----------------------|------------------------------|
| remember / understand| misconception (Begriffsirrtümer) |
| apply / analyze      | typical_error (Anwendungsfehler) |
| apply (rechenlastig) | calculation_trap             |
| evaluate / create    | typical_error + misconception|

Diese Korrelation fließt als **Soft-Signal** in die Anomalie-Erkennung ein, erzeugt aber keinen Hard-Fail.

---

## 7. Eskalationslogik

| Zustand                      | Signal  | Aktion                           |
|------------------------------|---------|----------------------------------|
| Alle Werte im Korridor       | ✅ ok   | Keine                            |
| Ein Wert unter warn_below    | ⚠️ warn | Leitstelle-Warnung               |
| Ein Wert unter hard_below    | 🔴 fail | Publishing blockiert             |
| Ein Wert über max_pct        | ⚠️ warn | Hinweis auf Übergewicht          |
| Zwei+ Werte unter warn_below | 🔴 fail | Auto-Rebalance-Trigger           |

---

## 8. Anti-Patterns

| Anti-Pattern                          | Grund                                  |
|---------------------------------------|----------------------------------------|
| ❌ Ist-Verteilung als Soll übernehmen | Zementiert historischen Drift          |
| ❌ Starres 33/33/34 für alle          | Ignoriert Berufsprofil                 |
| ❌ trap_type nur aus Difficulty        | Zu grob, keine didaktische Präzision   |
| ❌ Korridor < 10 Prozentpunkte        | Zu eng, erzeugt False-Positive-Fails   |

---

## Änderungsprotokoll

| Datum      | Änderung                     | Autor  |
|------------|------------------------------|--------|
| 2026-03-25 | Initiale Definition v1.0     | System |
