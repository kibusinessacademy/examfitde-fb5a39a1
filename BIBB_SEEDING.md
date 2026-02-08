# BIBB Seeding Dokumentation

## Übersicht

Dieses Dokument beschreibt den kompletten Seeding-Prozess für die Lernplattform-Datenbank basierend auf offiziellen BIBB-Daten (Bundesinstitut für Berufsbildung).

## Datenquellen

### 1. Verzeichnis der anerkannten Ausbildungsberufe
- **Quelle**: BIBB Jahresausgabe 2025
- **URL**: https://www.bibb.de/dienst/publikationen/de/20423
- **Inhalt**: Alle 327 aktuell anerkannten Ausbildungsberufe mit Metadaten
- **Format**: PDF (manuell), Web-Scraping (automatisch)

### 2. Berufesuche (Profilseiten)
- **Liste nach Jahr**: https://www.bibb.de/de/berufeinfo.php/legal_basis/
- **Profil-URL-Schema**: `https://www.bibb.de/dienst/berufesuche/de/index_berufesuche.php/profile/apprenticeship/{BIBB_ID}`
- **Inhalt**: Detaillierte Profilseiten je Beruf mit Links zu Dokumenten

### 3. KMK-Rahmenlehrpläne
- **Quelle**: Kultusministerkonferenz
- **URL**: https://www.kmk.org/themen/berufliche-schulen/duale-berufsausbildung/downloadbereich-rahmenlehrplaene.html
- **Inhalt**: Schulische Rahmenlehrpläne mit Lernfeldern

## Automatisiertes Seeding

### Edge Function: `bibb-seeding`

Die Edge Function `supabase/functions/bibb-seeding/index.ts` ermöglicht automatisches Seeding via Firecrawl.

**Aktionen:**

| Action | Beschreibung |
|--------|--------------|
| `status` | Gibt aktuelle Statistiken zurück (Anzahl Berufe, Dokumente) |
| `list_berufe` | Scrapt BIBB-Verzeichnis und listet alle Berufs-IDs |
| `scrape_beruf` | Importiert einen einzelnen Beruf inkl. Dokumente |
| `scrape_all` | Ermittelt alle noch nicht importierten Berufe |

**API-Beispiele:**

```bash
# Status abrufen
curl -X POST https://your-project.supabase.co/functions/v1/bibb-seeding \
  -H "Content-Type: application/json" \
  -d '{"action": "status"}'

# Einzelnen Beruf importieren
curl -X POST https://your-project.supabase.co/functions/v1/bibb-seeding \
  -H "Content-Type: application/json" \
  -d '{"action": "scrape_beruf", "bibbId": "rtretgf"}'
```

### Admin-UI

Die Admin-Seite unter `/admin-v2/bibb-seeding` bietet:

1. **Statistiken**: Anzahl importierter Berufe und Dokumente
2. **BIBB-Verzeichnis scannen**: Ermittelt alle verfügbaren Berufe
3. **Seeding starten**: Importiert alle ausstehenden Berufe automatisch
4. **Einzelimport**: Manueller Import via BIBB-ID
5. **Log-Ansicht**: Echtzeit-Protokoll des Import-Prozesses

## Datenbankstruktur

```
berufe (327 Einträge geplant)
  ├── bibb_id (eindeutige BIBB-Kennung)
  ├── bezeichnung_kurz / bezeichnung_lang
  ├── zustaendigkeit (IH, Hw, ÖD, Lw, etc.)
  ├── ausbildungsdauer_monate
  ├── dqr_niveau
  ├── bibb_profil_url
  ├── verordnung_pdf_url
  ├── rahmenlehrplan_url
  └── beruf_dokumente (1:n)
        ├── dokument_typ (ausbildungsverordnung, rahmenlehrplan, zeugniserlaeuterung, etc.)
        ├── titel
        ├── url
        └── sprache (de, en, fr)
```

## Bekannte BIBB-IDs

| BIBB-ID | Bezeichnung | Jahr |
|---------|-------------|------|
| rtretgf | Kaufmann für Digitalisierungsmanagement | 2020 |
| dsafsf | Kaufmann für IT-System-Management | 2020 |
| 80000 | Fachinformatiker | 2020 |
| hhffgdfd | IT-System-Elektroniker | 2020 |
| indust24 | Industriekaufmann | 2024 |
| kfmfb25 | Kaufmann für Büromanagement | 2025 |
| 261016 | Kaufmann im E-Commerce | 2017 |

## Seeding-Prozess (manuell)

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

### Berufe-Dokumente prüfen
```sql
SELECT 
  b.bezeichnung_kurz,
  COUNT(bd.id) as dokumente,
  array_agg(bd.dokument_typ) as typen
FROM berufe b
LEFT JOIN beruf_dokumente bd ON bd.beruf_id = b.id
GROUP BY b.id, b.bezeichnung_kurz
ORDER BY b.bezeichnung_kurz;
```

## Technische Abhängigkeiten

- **Firecrawl Connector**: Muss in Lovable Cloud verbunden sein
- **Service Role Key**: Für Schreibzugriff auf Datenbank
- **Rate Limiting**: 1.5s Pause zwischen Scrape-Requests

## Datenqualitäts-Status (Stand: 2026-02-08)

| Feld | Vollständigkeit | Bemerkung |
|------|-----------------|-----------|
| `bezeichnung_kurz` | 100% | Alle 326 Berufe importiert |
| `dqr_niveau` | 100% | DQR 4 (Standard für duale Ausbildung) |
| `verordnung_pdf_url` | 97.5% | 318 von 326 |
| `taetigkeitsprofil` | 89.6% | 292 von 326 |
| `rahmenlehrplan_url` | 0.6% | Nur 2 – KMK-URLs extern, manueller Import erforderlich |

### Hinweis zu Rahmenlehrplänen
Die KMK-Rahmenlehrpläne sind **nicht** auf den BIBB-Profilseiten verlinkt. Sie müssen separat von der KMK-Website importiert werden:
- **URL**: https://www.kmk.org/themen/berufliche-schulen/duale-berufsausbildung/downloadbereich-rahmenlehrplaene.html
- **Action**: `scrape_kmk` in der Edge Function

## Changelog

- **2026-02-08**: Initiales Seeding mit 5 Berufen, 2 vollständigen Curricula
- **2026-02-08**: Testdaten bereinigt, Produktionsdaten eingefügt
- **2026-02-08**: Fachinformatiker-Kurs komplett implementiert
- **2026-02-08**: BIBB-Seeding Edge Function mit Firecrawl implementiert
- **2026-02-08**: Admin-UI für automatisiertes Seeding erstellt
- **2026-02-08**: DQR-Niveau für alle 326 Berufe auf DQR 4 gesetzt
- **2026-02-08**: Erweiterte Stats mit Vollständigkeitsmetriken
- **2026-02-08**: `enrich_missing` Action für automatische Datenanreicherung
