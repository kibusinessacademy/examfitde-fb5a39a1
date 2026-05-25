/**
 * Berufs-KI Workbench (`/berufs-ki/app`, `/prompts` alias) — Premium-Katalog.
 *
 * Premium UI: Search · Multi-Filter (Kategorie/Tier/Klasse) · Card-Grid · Modal-Runner.
 * Reine Frontend-Refinement-Schicht — keine Logik-Änderung.
 */
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useSearchParams } from "react-router-dom";
import { Loader2, Lock, Sparkles, Search, Layers, GraduationCap, ShieldCheck, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { listWorkflows } from "@/lib/berufs-ki/api";
import { BERUFS_KI, CATEGORY_LABEL, tierLabel } from "@/lib/berufs-ki/copy";
import type { WorkflowCategory, WorkflowClass, WorkflowDefinition, WorkflowTier } from "@/lib/berufs-ki/types";
import WorkflowRunner from "@/components/berufs-ki/WorkflowRunner";
import SubmissionDialog from "@/components/berufs-ki/SubmissionDialog";
import { BerufIdentityChip } from "@/components/os/BerufIdentityChip";
import { useOsBeruf } from "@/lib/os/os-identity";
import { UsageIntelligenceCard } from "@/components/berufs-ki/UsageIntelligenceCard";
import { UpgradeRecommendationBanner } from "@/components/berufs-ki/UpgradeRecommendationBanner";
import { LockedWorkflowPreview } from "@/components/berufs-ki/LockedWorkflowPreview";
import { useAuth } from "@/hooks/useAuth";

const CATEGORIES: WorkflowCategory[] = [
  "kommunikation", "analyse", "dokumentation", "organisation", "fach", "lernhilfe",
];
const TIERS: WorkflowTier[] = ["free", "pro", "business"];
const CLASS_LABEL: Record<WorkflowClass, string> = {
  official: "Offiziell",
  community_verified: "Community-Verified",
  blueprint_materialized: "Blueprint",
  experimental: "Experimentell",
};

/** Fuzzy match: lowercase substring across title/description/category. */
export function matchesQuery(w: WorkflowDefinition, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = `${w.title} ${w.description} ${CATEGORY_LABEL[w.category] ?? w.category} ${w.slug}`.toLowerCase();
  return hay.includes(needle);
}

/** Pure filter — exported for tests. */
export function filterWorkflows(
  rows: WorkflowDefinition[],
  opts: { category: WorkflowCategory | null; tier: WorkflowTier | null; klass: WorkflowClass | null; query: string },
): WorkflowDefinition[] {
  return rows.filter((w) =>
    (opts.category === null || w.category === opts.category) &&
    (opts.tier === null || w.tier_required === opts.tier) &&
    (opts.klass === null || (w.workflow_class ?? "official") === opts.klass) &&
    matchesQuery(w, opts.query),
  );
}

export default function BerufsKIWorkbenchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const beruf = useOsBeruf();
  const { user } = useAuth();

  const [activeCategory, setActiveCategory] = useState<WorkflowCategory | null>(
    (searchParams.get("category") as WorkflowCategory | null) ?? null,
  );
  const [activeTier, setActiveTier] = useState<WorkflowTier | null>(null);
  const [activeClass, setActiveClass] = useState<WorkflowClass | null>(null);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [workflows, setWorkflows] = useState<WorkflowDefinition[] | null>(null);
  const [activeSlug, setActiveSlug] = useState<string | null>(searchParams.get("w"));
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listWorkflows()
      .then(setWorkflows)
      .catch((e) => setError((e as Error).message));
  }, []);

  // URL-Sync (debounced via state-only)
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeCategory) next.set("category", activeCategory);
    if (query.trim()) next.set("q", query.trim());
    if (activeSlug) next.set("w", activeSlug);
    setSearchParams(next, { replace: true });
  }, [activeCategory, query, activeSlug, setSearchParams]);

  const filtered = useMemo(
    () => (workflows ? filterWorkflows(workflows, { category: activeCategory, tier: activeTier, klass: activeClass, query }) : []),
    [workflows, activeCategory, activeTier, activeClass, query],
  );

  const activeWorkflow = useMemo(
    () => (workflows && activeSlug ? workflows.find((w) => w.slug === activeSlug) ?? null : null),
    [workflows, activeSlug],
  );

  const counts = useMemo(() => {
    const total = workflows?.length ?? 0;
    const free = workflows?.filter((w) => w.tier_required === "free").length ?? 0;
    return { total, free };
  }, [workflows]);

  const filtersActive = activeCategory !== null || activeTier !== null || activeClass !== null || query.trim().length > 0;
  const clearFilters = () => { setActiveCategory(null); setActiveTier(null); setActiveClass(null); setQuery(""); };

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>Berufs-KI Workbench · ExamFit</title>
        <meta name="description" content={BERUFS_KI.brand.promise} />
      </Helmet>

      {/* Premium-Header */}
      <div className="border-b border-border/60 bg-gradient-to-b from-primary/5 via-background to-background">
        <div className="mx-auto max-w-7xl px-4 pt-10 pb-8 md:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary/80">
                <Sparkles className="h-3.5 w-3.5" /> Berufs-KI · Workbench
              </div>
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{BERUFS_KI.workbench.placeholder}</h1>
              <p className="max-w-2xl text-sm text-muted-foreground">{BERUFS_KI.brand.promise}</p>
              <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" /> {counts.total} Workflows</span>
                <span className="inline-flex items-center gap-1"><GraduationCap className="h-3 w-3" /> {counts.free} kostenlos</span>
                <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Governance-geprüft</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <SubmissionDialog />
              <BerufIdentityChip />
            </div>
          </div>

          {/* Search */}
          <div className="mt-6 relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              role="searchbox"
              aria-label="Workflows durchsuchen"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suche: Kundenmail, KPI-Auswertung, Reklamation …"
              className="pl-9 h-11 text-base"
            />
            {query && (
              <button
                aria-label="Suche löschen"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <FilterChip active={activeCategory === null && !activeTier && !activeClass} onClick={() => { setActiveCategory(null); setActiveTier(null); setActiveClass(null); }}>
              Alle
            </FilterChip>
            {CATEGORIES.map((cat) => (
              <FilterChip key={cat} active={activeCategory === cat} onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}>
                {CATEGORY_LABEL[cat]}
              </FilterChip>
            ))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {TIERS.map((t) => (
              <FilterChip key={t} active={activeTier === t} onClick={() => setActiveTier(activeTier === t ? null : t)}>
                {tierLabel(t)}
              </FilterChip>
            ))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {(["official", "blueprint_materialized", "community_verified", "experimental"] as WorkflowClass[]).map((k) => (
              <FilterChip key={k} active={activeClass === k} onClick={() => setActiveClass(activeClass === k ? null : k)}>
                {CLASS_LABEL[k]}
              </FilterChip>
            ))}
            {filtersActive && (
              <Button size="sm" variant="ghost" onClick={clearFilters} className="ml-auto">Filter zurücksetzen</Button>
            )}
          </div>
        </div>
      </div>

      {/* Catalog grid */}
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-6">
        {!workflows && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Workflows…
          </div>
        )}
        {error && <p className="text-sm text-destructive" role="alert">Fehler: {error}</p>}

        {workflows && filtered.length === 0 && (
          <Card><CardContent className="py-14 text-center">
            <p className="text-sm text-muted-foreground">Keine Workflows passen zu deiner Auswahl.</p>
            {filtersActive && <Button size="sm" variant="outline" className="mt-3" onClick={clearFilters}>Filter zurücksetzen</Button>}
          </CardContent></Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="workflow-grid">
          {filtered.map((w) => (
            <WorkflowCard key={w.id} workflow={w} onOpen={() => setActiveSlug(w.slug)} />
          ))}
        </div>

        {beruf?.label && filtered.length > 0 && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Heute aktiv im Berufskontext: <span className="font-medium text-foreground">{beruf.label}</span>.
          </p>
        )}
      </div>

      {/* Modal Runner */}
      <Dialog open={!!activeWorkflow} onOpenChange={(open) => !open && setActiveSlug(null)}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0">
          <DialogTitle className="sr-only">{activeWorkflow?.title ?? "Workflow"}</DialogTitle>
          {activeWorkflow && (
            <div className="p-6">
              <WorkflowRunner workflow={activeWorkflow} onClose={() => setActiveSlug(null)} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
        active
          ? "bg-primary text-primary-foreground border-primary shadow-sm"
          : "bg-background text-foreground/80 border-border hover:border-primary/50 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function WorkflowCard({ workflow, onOpen }: { workflow: WorkflowDefinition; onOpen: () => void }) {
  const locked = workflow.tier_required !== "free";
  const klass = workflow.workflow_class ?? "official";
  return (
    <button
      onClick={onOpen}
      className="group text-left rounded-xl border bg-card p-5 transition-all hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      data-testid="workflow-card"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="text-[10px]">{CATEGORY_LABEL[workflow.category]}</Badge>
        {locked && (
          <Badge className="gap-1 text-[10px]"><Lock className="h-2.5 w-2.5" />{tierLabel(workflow.tier_required)}</Badge>
        )}
        {klass !== "official" && (
          <Badge variant="outline" className="text-[10px]">{CLASS_LABEL[klass]}</Badge>
        )}
        {workflow.curriculum_id && <span className="text-[10px] text-muted-foreground" aria-label="Lernpaket-Bindung">📦</span>}
        {workflow.competency_id && <span className="text-[10px] text-muted-foreground" aria-label="Kompetenz-Bindung">🎯</span>}
      </div>
      <h3 className="mt-3 text-base font-semibold leading-snug group-hover:text-primary">{workflow.title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground line-clamp-3">{workflow.description}</p>
      <div className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        Workflow öffnen →
      </div>
    </button>
  );
}
