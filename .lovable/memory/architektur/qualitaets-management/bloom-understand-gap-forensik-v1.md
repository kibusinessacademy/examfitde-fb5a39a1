# Memory: architektur/qualitaets-management/bloom-understand-gap-forensik-v1
Updated: 2026-03-17

## Root Cause: Systemische understand-Lücke

Der `generate-questions` Generator nutzte nur 4 kognitive Stufen (recall, apply, analyze, decide). Bloom-Level K2 (`understand`) existierte nicht im Generator — war daher bei 0% in allen generierten Pools.

## Heuristischer Backfill (Phase 1)

Breite Keyword-Heuristik (`erklären|warum|unterschied|bedeutung|prinzip|vorteil|nachteil|...`) auf approved Fragen angewendet:

**Elektroniker BT (3.155 approved):**
- understand: 0% → 6.8% (215 Fragen reklassifiziert) — Gate: 12% → Lücke ~164
- easy: 26.3% → 18.1% (258 Berechnungsfragen → medium) — Gate: <15% → Lücke ~97

**Mechatroniker (9.900 approved):**
- understand: 0% → 5.9% (587 Fragen reklassifiziert) — Gate: 12% → Lücke ~601
- easy: 26.3% → 18.8% (740 Berechnungsfragen → medium) — Gate: <15% → Lücke ~376

## Generator-Fix (Phase 2)

`generate-questions` erweitert auf 5 kognitive Stufen:
- recall: 20% (vorher 25%)
- understand: 15% (NEU)
- apply: 30% (vorher 35%)
- analyze: 20% (vorher 25%)
- decide: 15% (gleich)

## Verbleibende Lücken (Phase 3 nötig)

Gezielte Nachgenerierung mit `cognitive_level=understand` für die verbleibenden Lücken erforderlich. Kein Voll-Reseed nötig.
