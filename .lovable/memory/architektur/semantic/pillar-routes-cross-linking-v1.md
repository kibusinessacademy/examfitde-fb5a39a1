---
name: Pillar/Satellite Routes + Cross-Linking v1 (Phase P4)
description: SEO-Routen /wissen/{beruf,kompetenz,pruefung}/:key — SSOT pillarPath/pillarSitemap, EntityPillarPage komponiert P1 Graph + P2 GroundedDocument + P3 JSON-LD + SemanticCrossLinks. JsonLdHead via Helmet (Schema aus @/lib/seo/schema). Orphan-Guard + Golden-Test.
type: feature
---

## Scope
Phase P4 macht aus der Authority-Logik (P1–P3) sichtbare, crawlbare Seitenarchitektur.

## SSOT
- `src/lib/semantic/pillarRoutes.ts` — `ROUTED_ENTITY_KINDS = [beruf, kompetenz, pruefung]`, `pillarPath`, `pillarPathByKind`, `pillarAbsoluteUrl`, `isRoutedEntityKind`.
- `src/lib/semantic/pillarSitemap.ts` — `pillarSitemapEntries(graph)` deterministisch, sortiert.
- `src/hooks/useKnowledgeGraph.ts` — Singleton-Hook (P4 leerer Snapshot; DB-Materializer landet in P5).
- `src/pages/wissen/EntityPillarPage.tsx` — generische Pillar/Satellite-Page, dispatch via `kind`. Wrapper: `WissenBerufPage`, `WissenKompetenzPage`, `WissenPruefungPage`.
- `src/components/seo/JsonLdHead.tsx` — `react-helmet-async`-Injector (waived in `seo-schema-ssot.baseline.json`, serialisiert nur Objekte aus `@/lib/seo/schema`).
- `src/components/seo/GroundingChunkList.tsx` — rendert P2 Chunks + Citation-Block.
- `src/components/seo/SemanticCrossLinks.tsx` — interne Verlinkung ausschließlich über `pillarPath()` + Resolver.

## Routen (in SEOLayout)
`/wissen/beruf/:key` · `/wissen/kompetenz/:key` · `/wissen/pruefung/:key`

## Guards
- `scripts/guards/pillar-routes-orphan-guard.mjs` + Workflow:
  1. Alle `ROUTED_ENTITY_KINDS` haben Route + Page-File.
  2. `EntityPillarPage` importiert P1/P2/P3 SSOT.
  3. Kein hand-geschriebenes `/wissen/(beruf|kompetenz|pruefung)/…` außerhalb SSOT-Allowlist (`pillarRoutes.ts`, `pillarSitemap.ts`, `AppRoutes.tsx`, Guard selbst).
- Bestehende: `seo-schema-ssot`, `semantic-no-examiner-bypass`.

## Tests
- `src/__tests__/pillar-routes.golden.test.ts` (4 Tests) — Routed-Kind-Liste, Pfad-Builder, sitemap-Determinismus.
- P1/P2/P3 Tests bleiben grün (30/30 gesamt).

## Hard rules
- Keine handgeschriebenen SEO-Texte — Pages rendern ausschließlich P2 Chunks + P3 Schema + P1 Cross-Links.
- Pillar-Page bleibt SSR-safe (kein I/O im Render, alles pure aus Hook).
- Examiner-Isolation bleibt: `semantic-no-examiner-bypass` deckt neue Pages mit ab.

## Next (P5)
DB-Materializer: `semantic_graph_snapshot` View + Edge-Function, `useKnowledgeGraph` lädt echten Snapshot, Sitemap-Generator integriert `pillarSitemapEntries(graph)`.
