/**
 * W1 Cut 1 — Semantic Related Links
 *
 * Tail-of-page block that surfaces graph-related entities for a given anchor:
 * "Das könnte in deiner Prüfung drankommen."
 *
 * Pure consumer of the semantic SSOT — never computes readiness/verdicts.
 */

import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, AlertTriangle, BookOpen, Mic, HelpCircle } from "lucide-react";
import { useKnowledgeGraph } from "@/hooks/useKnowledgeGraph";
import {
  relatedCompetencies,
  relatedMistakes,
  relatedOralPatterns,
  relatedRisks,
  relatedFaqs,
} from "@/lib/semantic";

interface Props {
  entityId: string;
  /** Default heading. */
  heading?: string;
  /** Limit per bucket. */
  limit?: number;
  className?: string;
}

const ICONS = {
  kompetenz: BookOpen,
  risiko: AlertTriangle,
  fehlerbild: AlertTriangle,
  oral: Mic,
  faq: HelpCircle,
} as const;

export function SemanticRelatedLinks({
  entityId,
  heading = "Das könnte in deiner Prüfung drankommen",
  limit = 4,
  className,
}: Props) {
  const graph = useKnowledgeGraph();

  const competencies = relatedCompetencies(graph, entityId).slice(0, limit);
  const risks = relatedRisks(graph, entityId).slice(0, limit);
  const mistakes = relatedMistakes(graph, entityId).slice(0, limit);
  const oral = relatedOralPatterns(graph, entityId).slice(0, limit);
  const faqs = relatedFaqs(graph, entityId).slice(0, limit);

  const total = competencies.length + risks.length + mistakes.length + oral.length + faqs.length;
  if (total === 0) return null;

  const buckets: Array<{
    title: string;
    icon: keyof typeof ICONS;
    items: Array<{ id: string; name: string; href: string }>;
  }> = [
    {
      title: "Kompetenzen",
      icon: "kompetenz",
      items: competencies.map((c) => ({ id: c.id, name: c.name, href: `/wissen/kompetenz/${encodeURIComponent(c.key)}` })),
    },
    {
      title: "Prüfungsrisiken",
      icon: "risiko",
      items: risks.map((r) => ({ id: r.id, name: r.name, href: `/wissen/risiko/${encodeURIComponent(r.key)}` })),
    },
    {
      title: "Typische Fehler",
      icon: "fehlerbild",
      items: mistakes.map((m) => ({ id: m.id, name: m.name, href: `/wissen/fehler/${encodeURIComponent(m.key)}` })),
    },
    {
      title: "Mündliche Muster",
      icon: "oral",
      items: oral.map((o) => ({ id: o.id, name: o.name, href: `/wissen/muendlich/${encodeURIComponent(o.key)}` })),
    },
    {
      title: "FAQ",
      icon: "faq",
      items: faqs.map((f) => ({ id: f.id, name: f.name, href: `/wissen/faq/${encodeURIComponent(f.key)}` })),
    },
  ].filter((b) => b.items.length > 0);

  return (
    <section className={`container max-w-5xl py-10 ${className ?? ""}`}>
      <div className="mb-6 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-petrol-600 dark:text-mint-400">
          Semantische Querverbindungen
        </p>
        <h2 className="text-xl md:text-2xl font-display font-bold text-text-primary">{heading}</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {buckets.map((bucket) => {
          const Icon = ICONS[bucket.icon];
          return (
            <Card key={bucket.title} variant="raised">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
                  <Icon className="h-4 w-4 text-petrol-600 dark:text-mint-400" />
                  {bucket.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-2">
                  {bucket.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        to={item.href}
                        className="group inline-flex items-center gap-1.5 text-sm text-text-primary hover:text-petrol-600 dark:hover:text-mint-400 transition-colors"
                      >
                        <span>{item.name}</span>
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
