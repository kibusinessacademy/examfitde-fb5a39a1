/**
 * Berufs-KI Workbench (`/berufs-ki/app`) — Workflow-Katalog + Runner.
 *
 * Linke Spalte: Kategorien + gefilterter Workflow-Katalog.
 * Rechte Spalte: WorkflowRunner für aktiv gewählten Workflow.
 */
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useSearchParams } from "react-router-dom";
import { Loader2, Lock, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listWorkflows } from "@/lib/berufs-ki/api";
import { BERUFS_KI, CATEGORY_LABEL, tierLabel } from "@/lib/berufs-ki/copy";
import type { WorkflowCategory, WorkflowDefinition } from "@/lib/berufs-ki/types";
import WorkflowRunner from "@/components/berufs-ki/WorkflowRunner";
import { BerufIdentityChip } from "@/components/os/BerufIdentityChip";
import { useOsBeruf } from "@/lib/os/os-identity";


const CATEGORIES: WorkflowCategory[] = [
  "kommunikation",
  "analyse",
  "dokumentation",
  "organisation",
  "fach",
  "lernhilfe",
];

export default function BerufsKIWorkbenchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const beruf = useOsBeruf();
  const initialCategory = (searchParams.get("category") as WorkflowCategory | null) ?? null;
  const [activeCategory, setActiveCategory] = useState<WorkflowCategory | null>(initialCategory);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[] | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listWorkflows()
      .then((rows) => setWorkflows(rows))
      .catch((e) => setError((e as Error).message));
  }, []);

  const filtered = useMemo(() => {
    if (!workflows) return [];
    return activeCategory ? workflows.filter((w) => w.category === activeCategory) : workflows;
  }, [workflows, activeCategory]);

  const activeWorkflow = useMemo(
    () => (workflows && activeSlug ? workflows.find((w) => w.slug === activeSlug) ?? null : null),
    [workflows, activeSlug],
  );

  function selectCategory(cat: WorkflowCategory | null) {
    setActiveCategory(cat);
    if (cat) setSearchParams({ category: cat }, { replace: true });
    else setSearchParams({}, { replace: true });
  }

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>Berufs-KI Workbench · ExamFit</title>
        <meta name="description" content={BERUFS_KI.brand.promise} />
      </Helmet>

      <div className="mx-auto max-w-7xl px-4 py-8 md:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Berufs-KI · Workbench
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">{BERUFS_KI.workbench.placeholder}</h1>
          </div>
          <BerufIdentityChip />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          {/* Catalog column */}
          <aside className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={activeCategory === null ? "default" : "outline"}
                onClick={() => selectCategory(null)}
              >
                Alle
              </Button>
              {CATEGORIES.map((cat) => (
                <Button
                  key={cat}
                  size="sm"
                  variant={activeCategory === cat ? "default" : "outline"}
                  onClick={() => selectCategory(cat)}
                >
                  {CATEGORY_LABEL[cat]}
                </Button>
              ))}
            </div>

            {!workflows && !error && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Lade Workflows…
              </div>
            )}
            {error && <p className="text-sm text-destructive">Fehler: {error}</p>}

            <div className="space-y-2">
              {filtered.map((w) => {
                const locked = w.tier_required !== "free";
                return (
                  <button
                    key={w.id}
                    onClick={() => setActiveSlug(w.slug)}
                    className={`w-full text-left rounded-lg border p-3 transition-all hover:border-primary hover:shadow-sm ${
                      activeSlug === w.slug ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {CATEGORY_LABEL[w.category]}
                      </Badge>
                      {locked && (
                        <Badge variant="default" className="gap-1 text-[10px]">
                          <Lock className="h-2.5 w-2.5" />
                          {tierLabel(w.tier_required)}
                        </Badge>
                      )}
                      {w.curriculum_id && (
                        <span className="text-[10px] text-muted-foreground" aria-label="Lernpaket-Bindung">📦</span>
                      )}
                    </div>
                    <div className="mt-1.5 text-sm font-medium leading-tight">{w.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{w.description}</div>
                  </button>
                );
              })}
              {workflows && filtered.length === 0 && (
                <p className="text-sm text-muted-foreground">Keine Workflows in dieser Kategorie.</p>
              )}
            </div>

          </aside>

          {/* Runner column */}
          <section>
            {activeWorkflow ? (
              <WorkflowRunner workflow={activeWorkflow} onClose={() => setActiveSlug(null)} />
            ) : (
              <Card className="h-full">
                <CardContent className="flex h-full min-h-[300px] flex-col items-center justify-center p-10 text-center">
                  <Sparkles className="mb-3 h-8 w-8 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">Wähle einen Workflow</h2>
                  <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                    Berufs-KI bringt dir berufsspezifische Workflows. {beruf?.label ? `Heute aktiv: ${beruf.label}.` : "Wähle links eine Kategorie."}
                  </p>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
