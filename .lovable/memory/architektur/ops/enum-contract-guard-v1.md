---
name: Enum Contract Guard v1
description: Generischer DB↔FE Enum-Drift-Guard via pg_enum (RPC get_enum_values). Erweitert persona-enum-contract um product_track (fe_subset) und app_role (db_only). CI-Gate in conversion-integrity-suite.
type: feature
---

## SSOT Pfad

- DB: `public.get_enum_values(text)` SECURITY DEFINER → liest pg_enum direkt (keine Daten-Proxies wie product_persona_overlays mehr)
- FE: `as const` Arrays in `src/lib/...`
- Guard: `scripts/enum-contract-guard.mjs` mit Modi `strict` | `fe_subset` | `db_only`

## Aktive Contracts

| Enum | Mode | FE-Source |
|---|---|---|
| product_persona | strict | src/lib/landing/productPersonaContext.ts:PRODUCT_PERSONAS |
| product_track | fe_subset (FORTBILDUNG/ZERTIFIKAT sind DB-Aliase → EXAM_FIRST_PLUS) | src/lib/tracks.ts:TRACKS |
| app_role | db_only (admin, learner, teacher) | — |

## Neue Contracts hinzufügen

CONTRACTS-Array in `scripts/enum-contract-guard.mjs` erweitern. Forbidden-Werte als Hard-Block.

## CI

`.github/workflows/conversion-integrity-suite.yml` läuft den Guard nach `persona-enum-contract` als zweiten Drift-Gate. Beide werden bei jedem PR auf relevanten Pfaden + alle 6h ausgeführt.
