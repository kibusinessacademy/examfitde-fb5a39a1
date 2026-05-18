---
name: Wave Priority-Queue Sync + Thin-Guard Defensive v1
description: 92 Wave-1-3 Rows ready/queued→generated synced (page existed). fn_seo_thin_content_guard defensive gegen Object-style internal_links (hub/quiz/tutor/trainer/siblings). Echter Wave-3-Rest = 12 Rows (Fachlagerist, Steuerfachangestellter, Verkäufer). 17 NO_CATALOG_MAPPING bleibt offen (certification_catalog-Backfill braucht Inhalts-Klassifizierung).
type: feature
---

## Befund 2026-05-18

`seo_content_priority_queue` war massiv desync mit `seo_content_pages`:
- Wave 1: 32/32 Rows (ready+queued) hatten längst published Pages
- Wave 2: 24/24 Rows desync
- Wave 3: 36/48 Rows desync (12 echt offen)

## Fix 1: Sync-Heal (Daten)
UPDATE 92 Rows ready/queued → `generated`, last_generated_at, audit `seo_priority_queue_sync_to_published`. Audit-Contract registriert (required_keys=wave,rows_updated,sync_kind).

## Fix 2: Thin-Guard defensive (Schema)
`fn_seo_thin_content_guard` crashed bei `jsonb_array_length(sections_json->'internal_links')` weil Realfall `internal_links` ein Object ist (hub/quiz/tutor/trainer/siblings). Fix mit `jsonb_typeof`-Switch: Array → length, Object → count(named keys) + siblings-array-length, sonst 0. Smoke-DO im Migration-Body validiert AEVO/Betriebswirt-Case.

## Echter Wave-3 Rest (12 Rows, alle thin-risk low)
- Rahmenlehrplan Fachlagerist / Unternehmensstrukturen analysieren × 4 Intents
- Rahmenlehrplan Steuerfachangestellter / Betriebsstrukturen erkennen × 4 Intents
- Rahmenlehrplan Verkäufer / Mit Konfliktsituationen umgehen × 4 Intents

Enqueue via `admin_seo_wave_enqueue_one` (single-row SSOT) wenn Wave 3 weiter rollen soll.

## Strukturelles Loch: 17 NO_CATALOG_MAPPING
17 published Pakete (FISI, FIAE, Bankkaufmann, Industriekaufmann, AEVO, Personalfachkaufmann, Verwaltungsfachangestellte, Scrum Master PSM I, Koch, Wohnimmobilienverwalter, Immobilienmakler/-darlehensvermittler, Anlagenmechaniker SHK, Einzelhandel, Kaufleute Umwelt/Nachhaltigkeit, Compliance Officer, Polizei-Theorie) haben **keine `certification_catalog`-Zeile** (linked_certification_id fehlt). Blockiert Cert-Pillar-Generation für die Top-Pakete.

`certification_catalog` braucht Pflichtfelder: title, slug, catalog_type (Ausbildung/Fortbildung_IHK/HWK/Meister/Sachkunde/...), chamber_type, recognition_type, track. Kein mechanischer Backfill — Inhalts-Entscheidung pro Paket.

**Anti-Drift:** Polizeivollzugsdienst NICHT katalogisieren (North-Star-Anti-Drift-Liste).
