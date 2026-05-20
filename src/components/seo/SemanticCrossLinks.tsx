/**
 * Phase P4 — Semantic cross-link section.
 *
 * Pure derivation from the P1 graph via resolvers. NO hand-curated lists.
 * All target URLs go through `pillarPath()` — direct `<a href="/wissen/...">`
 * is blocked by `scripts/guards/pillar-routes-orphan-guard.mjs`.
 */

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { KnowledgeGraph } from "@/lib/semantic";
import {
  isRoutedEntityKind,
  pillarPath,
  relatedCompetencies,
  relatedExamScenarios,
  type SemanticEntity,
} from "@/lib/semantic";

interface LinkRow {
  key: string;
  label: string;
  to: string;
  group: string;
}

function rowsFor(graph: KnowledgeGraph, entity: SemanticEntity, max: number): LinkRow[] {
  const rows: LinkRow[] = [];

  const push = (e: SemanticEntity, group: string) => {
    if (!isRoutedEntityKind(e.kind)) return;
    const to = pillarPath(e);
    if (!to) return;
    rows.push({ key: `${e.kind}:${e.id}`, label: e.name, to, group });
  };

  for (const k of relatedCompetencies(graph, entity.id).slice(0, max)) {
    push(k, "Verwandte Kompetenzen");
  }
  for (const p of relatedExamScenarios(graph, entity.id).slice(0, max)) {
    push(p, "Prüfungsformen");
  }

  // Dedup by (kind,id) keeping first group label.
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

export interface SemanticCrossLinksProps {
  graph: KnowledgeGraph;
  entity: SemanticEntity;
  max?: number;
  title?: string;
}

export function SemanticCrossLinks({
  graph,
  entity,
  max = 8,
  title = "Verwandte Themen",
}: SemanticCrossLinksProps) {
  const rows = rowsFor(graph, entity, max);
  if (rows.length === 0) return null;

  const grouped = rows.reduce<Record<string, LinkRow[]>>((acc, r) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});

  return (
    <nav aria-label={title} className="mt-10">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group}>
            <h3 className="text-sm font-medium text-muted-foreground">{group}</h3>
            <ul className="mt-2 space-y-1.5">
              {items.map((r) => (
                <li key={r.key}>
                  <Link
                    to={r.to}
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    {r.label}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
