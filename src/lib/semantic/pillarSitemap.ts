/**
 * Phase P4 — Sitemap helper for Pillar/Satellite routes.
 *
 * Pure function: graph → SitemapEntry[]. Consumed by
 * `scripts/generate-sitemap.ts` (P5 wiring). Determinism guaranteed by
 * graph traversal ordering.
 */

import type { KnowledgeGraph } from "./KnowledgeGraph";
import { ROUTED_ENTITY_KINDS, pillarPath } from "./pillarRoutes";

export interface PillarSitemapEntry {
  path: string;
  lastmod: string;
  changefreq: "weekly";
  priority: string;
}

export function pillarSitemapEntries(graph: KnowledgeGraph): PillarSitemapEntry[] {
  const out: PillarSitemapEntry[] = [];
  const lastmod = graph.snapshot_at.slice(0, 10);
  for (const kind of ROUTED_ENTITY_KINDS) {
    for (const e of graph.entitiesOfKind(kind)) {
      const path = pillarPath(e);
      if (!path) continue;
      out.push({
        path,
        lastmod,
        changefreq: "weekly",
        priority: kind === "beruf" ? "0.8" : "0.6",
      });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
