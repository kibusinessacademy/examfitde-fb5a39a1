---
name: Bund-API Lagebild v1
description: VerwaltungsOS Live-Lagebild aus öffentlichen Bund.dev-APIs (NINA + Pegel-Online) als Read-only Aggregator-Layer auf /branchen/verwaltung.
type: feature
---

# VerwaltungsOS — Bund-API Lagebild v1 (FROZEN 2026-05-27)

## Scope

Read-only Aggregator-Edge-Function + UI-Sektion, die öffentliche, keyless
Schnittstellen aus dem **bund.dev**-Ökosystem zu einem verwaltungstauglichen
Echtzeit-Lagebild zusammenführt.

## SSOT

- **Edge Function**: `supabase/functions/verwaltung-bund-lagebild/index.ts`
  (`verify_jwt = false`, public, 60s In-Memory-Cache pro `ARS|include_pegel`)
- **UI**: `src/components/verticals/VerwaltungBundLagebildSection.tsx`,
  gemountet in `src/pages/verticals/VerticalDetailPage.tsx` nur für
  `vertical.slug === "verwaltung"` (direkt nach `VerwaltungDepartmentsSection`).
- **Smoke**: `scripts/verwaltung-bund-lagebild-smoke.mjs` → GREEN
  (HTTP 200, warnings[]/pegel[] shape, 40 reale Pegelstände live).

## Quellen (alle keyless, OpenData)

1. **NINA** — `https://warnung.bund.de/api31/dashboard/{ARS}.json`
   Bundesamt für Bevölkerungsschutz: MoWaS + DWD Wetterwarnungen + LHP
   Hochwasser + Polizei + BIWAPP, gefiltert pro Amtlicher Regionalschlüssel.
2. **Pegel-Online (WSV)** — `https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json`
   Wasserstands-Messstellen Rhein/Elbe/Donau mit aktuellem Wert + Trend.

## Anti-Drift-Regeln

- **Read-only Pass-Through**: keine eigene Bewertung, keine generative AI,
  keine Persistenz. Jede Warnung führt `source` (MOWAS/DWD/LHP/POLICE/BIWAPP)
  explizit mit.
- **Kein Schreibpfad**: keine Tabelle, kein Trigger, kein Audit-Contract.
  Wenn später Audit nötig wird → über `fn_emit_audit` mit eigenem
  `action_type` registrieren, nicht ad-hoc.
- **Kein Secret**: weder NINA noch Pegel-Online benötigen Keys. Niemals
  einen privaten API-Key in diese Function ziehen.
- **Cache nur In-Memory**: 60s TTL pro Edge-Worker. Bewusst nicht in DB —
  Lagebild muss live sein, nicht historisiert.
- **CORS offen** durch `corsHeaders` aus `npm:@supabase/supabase-js@2/cors`.

## Erweiterungs-Roadmap (nicht jetzt bauen)

Weitere bund.dev-APIs sind kompatibel mit dem gleichen Aggregator-Pattern und
können später als zusätzliche Layer angeflanscht werden — strikt read-only:

- Lebensmittelwarnungen (BVL) → für Gesundheits-/Ordnungsamt
- Luftqualität (UBA) → für Umweltamt
- Reisewarnungen (Auswärtiges Amt) → für Bürgerservice
- Ladesäulenregister (BNetzA) → für Stadtplanung
- DESTATIS / Dashboard Deutschland → später in Executive Mission Control,
  NICHT hier (gehört in einen Statistik-Layer, nicht ins Live-Lagebild).
- Bundestag/Bundesrat DIP → später für Rechtsamt-Layer.

Jede Erweiterung muss eigene Quelle in `meta.sources` mitführen und
`severity`/`source` analog typisieren.

## Tests

- `node scripts/verwaltung-bund-lagebild-smoke.mjs` → GREEN
  (Berlin ARS, 200, warnings+pegel arrays, 40 live Pegel).

## Strategischer Claim

VerwaltungsOS ist nicht nur DNA + Oral-Bridge + DailyBrief, sondern auch an
**echte staatliche Live-Daten** angebunden — ohne API-Key-Friktion, ohne
Vendor-Lock-in, mit klarer Quellen-Transparenz.
