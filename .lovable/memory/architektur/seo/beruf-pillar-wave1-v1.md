---
name: Beruf-Intent Pillar Wave 1 v1
description: 20 Top-Berufe × 2 Intents Pillar-Strategie, Semrush-validiert, musterfragen als H2 statt eigene Seite
type: feature
---

# Beruf-Intent Pillar Wave 1

**Ziel**: Top-Rankings für `prüfungsvorbereitung <beruf>` + `prüfungsfragen <beruf>` für die 20 volumenstärksten Berufe im ExamFit-Katalog. `musterfragen <beruf>` läuft als H2-Sektion **innerhalb** des prüfungsfragen-Pillars (Semrush DE: 0/20 Stichprobe mit Volumen → eigene Seiten wären Thin-Content-Suizid).

## Scope-Entscheidung (User 2026-05-21)

- 20 Berufe × 2 Intents = **40 Pillar-Pages**
- musterfragen-Variante: H2-Sektion (kein eigener Slug, keine eigene Registry-Row)
- Strikte Kanonik: `/blog/pruefungs(vorbereitung|fragen)-<cert_slug>-pillar-guide` als Default. Bereits live-existierende Short-Slugs (MFA, KfB) bleiben — Registry trackt die echte URL.

## Top-20 (Volumen-sortiert, Semrush DE 2026-05)

| Rang | Beruf | cert_slug | PV-Vol | PF-Vol |
|---|---|---|---|---|
| 1 | MFA | medizinische-r-fachangestellte-r | 480 | 110 |
| 2 | Kauffrau für Büromanagement | kaufmann-fuer-bueromanagement | 320 | — |
| 3 | Industriekaufmann | industriekaufmann-frau | 170 | 30 |
| 4 | Fachinformatiker SI | fachinformatiker-systemintegration | 140 | — |
| 5 | Fachkraft Lagerlogistik | fachkraft-fuer-lagerlogistik | 140 | — |
| 6 | Fachinformatiker AE | fachinformatiker-anwendungsentwicklung | 30 | 20 |
| 7 | AEVO | aevo-ausbildereignungsprüfung | 90 | — |
| 8 | Steuerfachangestellte | steuerfachangestellter-in | 90 | — |
| 9 | Industriemechaniker | industriemechaniker-in | 50 | — |
| 10 | Verkäufer | verkaeufer | 50 | 30 |
| 11–20 | Bankkaufmann, Verwaltungsfach, Anlagenmech, Bilanzbuch, Betriebswirt, Industriemeister Metall, Friseur, Pflegefachmann, Tischler, Bäcker | — | 20–30 | 0–20 |

KDI durchgehend 0–12/100 → wenn Suchanfrage gestellt wird, sind wir leicht rankbar.

## SSOT-Layer

- **growth_keyword_registry**: 40 Rows mit `funnel_stage='exam_prep'`, `canonical_intent='informational'`, `persona='azubi'`, `owner_kind='blog_article'`.
- **status='active'**: 4 (MFA + KfB jeweils PV + PF). **status='reserved'**: 36 (geplant, noch nicht publiziert).
- **notes-Prefix**: `Wave1 Beruf-Pillar | intent=...` → Filter für Wave-Tracking.
- Identifier: `notes LIKE 'Wave1%'`.

## Pillar-Template (für Folge-Batches)

Pflicht-Elemente pro Pillar:
1. 30-Sekunden-Antwort (LLM-Citation-optimiert)
2. 3 legitime Quellen (Kammer + Lehrbuch + digital)
3. 6 echte Musterfragen mit Schwierigkeitstypen (MC, Kurzantwort, programmierte Aufgabe)
4. Punkte-Tabelle (Übungsmenge → Notenziel)
5. Fehler-Liste (5 typische)
6. Wochenplan
7. FAQ-JSON (5 Fragen) + `internal_links_json` (4: Produktseite + Sibling-Pillar + Cluster-Spoke + Persona-Hub)
8. word_count ≥ 800, `article_type='pillar'`

## Live-Stand 2026-05-21

| Komponente | Stand |
|---|---|
| Registry-Rows | 40 (4 active, 36 reserved) |
| Published Pillars Wave 1 | 4 (MFA × 2, KfB × 2) |
| Reservierte Pillars | 36 |
| Audit | `auto_heal_log.action_type='seo_beruf_pillar_wave1_published'` |

## Nächste Batches (vorgeschlagene Reihenfolge nach Volumen)

**Batch 2 (5 PV-Pillars, höchstes Volumen)**:
1. Industriekaufmann (170)
2. Fachinformatiker Systemintegration (140)
3. Fachkraft Lagerlogistik (140)
4. AEVO (90)
5. Steuerfachangestellte (90)

**Batch 3 (5 PV)**: Industriemechaniker, Verkäufer, Bankkaufmann, Verwaltungsfach, Anlagenmechaniker SHK
**Batch 4 (6 PV)**: Bilanzbuch, Betriebswirt, Industriemeister Metall, Friseur, Pflegefachmann, Tischler/Bäcker
**Batch 5 (alle PF außer MFA/KfB)**: 18 PF-Pillars, jede mit musterfragen-H2

## Anti-Drift-Regeln

- KEINE Seiten für `musterfragen <beruf>` als eigener Slug (Semrush no-data + Self-Cannibalization)
- KEINE Berufe < 20/mo Volumen ohne explizite Strategie-Bestätigung
- KEINE Brute-Force-Generierung über `admin_seo_wave_enqueue_one` für diese Pillars (handgeschrieben, kuratiert)
- JEDER neue Pillar muss in Registry als 'active' markiert werden, owner_url muss matchen
- Cross-Linking PV ↔ PF Pillar ist Pflicht (`pillar_sibling`)
