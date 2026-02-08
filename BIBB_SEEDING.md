# BIBB Seeding Dokumentation

## Übersicht

Dieses Dokument beschreibt den kompletten Seeding-Prozess für die Lernplattform-Datenbank basierend auf offiziellen BIBB-Daten (Bundesinstitut für Berufsbildung).

## Datenquellen

### 1. Verzeichnis der anerkannten Ausbildungsberufe
- **Quelle**: BIBB Jahresausgabe 2025
- **URL**: https://www.bibb.de/dienst/publikationen/de/19277
- **Inhalt**: Alle aktuell anerkannten Ausbildungsberufe mit Metadaten

### 2. Berufesuche (Profilseiten)
- **URL**: https://www.bibb.de/dienst/berufesuche/de/
- **Inhalt**: Detaillierte Profilseiten je Beruf mit Links zu Dokumenten

### 3. KMK-Rahmenlehrpläne
- **Quelle**: Kultusministerkonferenz
- **URL**: https://www.kmk.org/themen/berufliche-schulen/duale-berufsausbildung/downloadbereich-rahmenlehrplaene.html
- **Inhalt**: Schulische Rahmenlehrpläne mit Lernfeldern

## Datenbankstruktur

```
berufe (5 Einträge)
  └── curricula (2 Einträge: Digitalisierungsmanagement, Fachinformatiker)
        └── learning_fields (25 Lernfelder total)
              └── competencies (90+ Kompetenzen)
                    └── modules → lessons (430+ Lektionen)
```

## Geseedete Berufe

| BIBB-ID | Bezeichnung | Dauer | DQR | Status |
|---------|-------------|-------|-----|--------|
| kfdigmgmt | Kaufmann für Digitalisierungsmanagement | 36 Mon. | 4 | ✅ Vollständig |
| kfitsysmgmt | Kaufmann für IT-System-Management | 36 Mon. | 4 | 📋 Beruf angelegt |
| kfbuero | Kaufmann für Büromanagement | 36 Mon. | 4 | 📋 Beruf angelegt |
| kfecomm | Kaufmann im E-Commerce | 36 Mon. | 4 | 📋 Beruf angelegt |
| fchinfmtk | Fachinformatiker | 36 Mon. | 4 | ✅ Vollständig |

## Seeding-Prozess

### Schritt 1: Berufe-Tabelle befüllen
```sql
INSERT INTO berufe (bibb_id, bezeichnung_kurz, zustaendigkeit, ausbildungsdauer_monate, dqr_niveau)
VALUES ('kfdigmgmt', 'Kaufmann für Digitalisierungsmanagement', 'IH', 36, 4);
```

### Schritt 2: Curricula anlegen
Pro Beruf werden separate Curricula für:
- **Betrieblicher Ausbildungsrahmenplan** (aus Ausbildungsverordnung)
- **Schulischer Rahmenlehrplan** (KMK-Beschluss)

```sql
INSERT INTO curricula (beruf_id, title, curriculum_typ, status)
VALUES (beruf_id, 'Kaufmann für Digitalisierungsmanagement - KMK Rahmenlehrplan', 'schulisch', 'frozen');
```

### Schritt 3: Lernfelder (Learning Fields) importieren
Aus KMK-Rahmenlehrplänen werden 10-13 Lernfelder extrahiert:

| Code | Titel | Stunden |
|------|-------|---------|
| LF01 | Das Unternehmen und die eigene Rolle im Betrieb beschreiben | 40 |
| LF02 | Arbeitsplätze nach Kundenwunsch ausstatten | 80 |
| ... | ... | ... |
| LF13 | Netzwerke und Dienste bereitstellen | 80 |

### Schritt 4: Kompetenzen ableiten
Pro Lernfeld werden 3-4 Kompetenzen definiert basierend auf:
- Kompetenzformulierungen im Rahmenlehrplan
- Taxonomiestufen (verstehen, anwenden, analysieren, entwickeln, bewerten)

### Schritt 5: 5-Schritte-Didaktik (Lektionen)
Pro Kompetenz werden 5 Lektionen nach der didaktischen Struktur erstellt:

1. **Einstieg** (15 Min.) - Aktivierung, Praxisbezug
2. **Verstehen** (25 Min.) - Theorie, Konzepte
3. **Anwenden** (30 Min.) - Praxisübungen
4. **Wiederholen** (20 Min.) - Festigung, Wiederholung
5. **Mini-Check** (10 Min.) - Selbsttest, Erfolgskontrolle

### Schritt 6: Kurs publizieren
```sql
INSERT INTO courses (curriculum_id, title, status, published_at)
VALUES (curriculum_id, 'Kaufmann für Digitalisierungsmanagement', 'published', NOW());
```

## Validierung

### Datenintegrität prüfen
```sql
SELECT 
  c.title as curriculum,
  COUNT(DISTINCT lf.id) as learning_fields,
  COUNT(DISTINCT comp.id) as competencies,
  COUNT(DISTINCT l.id) as lessons
FROM curricula c
LEFT JOIN learning_fields lf ON lf.curriculum_id = c.id
LEFT JOIN competencies comp ON comp.learning_field_id = lf.id
LEFT JOIN modules m ON m.learning_field_id = lf.id
LEFT JOIN lessons l ON l.module_id = m.id
GROUP BY c.id, c.title;
```

### Erwartete Ergebnisse

| Curriculum | Lernfelder | Kompetenzen | Lektionen |
|------------|------------|-------------|-----------|
| Digitalisierungsmanagement | 13 | 47 | 215 |
| Fachinformatiker (AE) | 12 | 44 | 110+ |

## Erweiterung

### Neuen Beruf hinzufügen
1. Beruf in `berufe` anlegen
2. Curriculum erstellen (Typ: betrieblich/schulisch)
3. Lernfelder aus Rahmenlehrplan extrahieren
4. Kompetenzen definieren
5. Module und Lektionen generieren
6. Kurs publizieren

### Automatisierung (geplant)
- PDF-Parser für Rahmenlehrpläne
- KI-gestützte Kompetenzextraktion
- Automatische Lektionsgenerierung

## Changelog

- **2026-02-08**: Initiales Seeding mit 5 Berufen, 2 vollständigen Curricula
- **2026-02-08**: Testdaten bereinigt, Produktionsdaten eingefügt
- **2026-02-08**: Fachinformatiker-Kurs komplett implementiert
