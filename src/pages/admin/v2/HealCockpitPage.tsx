/**
 * Heal Cockpit — /admin/heal
 *
 * Single Pane of Glass für ALLE Heal-/Recovery-/Repair-Funktionen.
 *
 * Konsolidiert ehemals separate Seiten:
 *   • /admin/queue            (UnifiedQueueCockpit Tabs: Live, Heal, Stuck, Repair, Stagnation, Retry, Wizard, Audit, Explain)
 *   • /admin/ops/blocker-ops  (Throughput, Reap, Hot-Loop, Triage, Recheck, Drill-down, Auto-Selector, Reaper)
 *   • /admin/ops/heal-settings (Auto-Repair Strategy Toggles)
 *
 * Layout-Pattern: Accordion mit empfohlener Bedienreihenfolge (Top → Bottom).
 * Default-Open: live + recover (häufigste Use-Cases).
 *
 * Empfohlene Bedienung (top-down im Accordion):
 *   1. Live Pulse        → Throughput + Blocker Counts checken
 *   2. Recover           → Reap Now → Hot-Loop Dry-Run → Execute
 *   3. Triage            → Failed-Cluster, Blocker-Split, Hollow → Track-Normalize
 *   4. Targeted Recheck  → Dry-Run der 4 Blocker-Klassen → Execute
 *   5. Drill-down        → Pakete pro Blocker inspizieren
 *   6. Auto-Selector     → Per-Paket Repair-Recommendation
 *   7. Reaper            → Config + Manual Run + Audit
 *   8. Strategien        → Auto-Repair Toggles
 *   9. Queue-Detail-Tabs → Live-Jobs, Stuck, Repair, Stagnation, Retry, Wizard, Audit
 */
import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity, AlertTriangle, Crosshair, Filter, Heart, ListChecks,
  RefreshCw, Settings, Shield, Stethoscope, Wand2, Wrench,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminPageHeader } from "@/components/admin/v2/AdminPageHeader";

import { ThroughputCard } from "@/components/admin/heal/cards/ThroughputCard";
import {
  BlockerCountsCard, type BlockerKey,
} from "@/components/admin/heal/cards/BlockerCountsCard";
import { RecoverActionsCard } from "@/components/admin/heal/cards/RecoverActionsCard";
import { TargetedHealCard } from "@/components/admin/heal/cards/TargetedHealCard";
import { StuckPatternsCard } from "@/components/admin/heal/cards/StuckPatternsCard";
import { HealStatusCard } from "@/components/admin/heal/cards/HealStatusCard";
import { QueueDrainCard } from "@/components/admin/heal/cards/QueueDrainCard";
import { BlockedPackagesCard } from "@/components/admin/heal/cards/BlockedPackagesCard";
import { TriageCards } from "@/components/admin/heal/cards/TriageCards";
import { TargetedRecheckCard } from "@/components/admin/heal/cards/TargetedRecheckCard";
import { DrillDownCard } from "@/components/admin/heal/cards/DrillDownCard";
import { AutoSelectorCard } from "@/components/admin/heal/cards/AutoSelectorCard";
import { ReaperGovernanceCard } from "@/components/admin/heal/cards/ReaperGovernanceCard";
import { HealStrategyCard } from "@/components/admin/heal/cards/HealStrategyCard";
import { AlertsBanner } from "@/components/admin/heal/cards/AlertsBanner";

// Queue-Detail-Tabs (lazy — schwer)
const QueueLiveTab = lazy(() => import("@/pages/admin/v2/QueuePage"));
const HealTab = lazy(() =>
  import("@/components/admin/queue-cockpit/HealCockpitTabContent").then((m) => ({
    default: m.HealCockpitTabContent,
  })),
);
const StuckTab = lazy(() =>
  import("@/components/admin/queue-cockpit/StuckStepsTabContent").then((m) => ({
    default: m.StuckStepsTabContent,
  })),
);
const RepairTab = lazy(() =>
  import("@/components/admin/queue-cockpit/RepairQueueTabContent").then((m) => ({
    default: m.RepairQueueTabContent,
  })),
);
const StagnationTab = lazy(() =>
  import("@/components/admin/queue-cockpit/StagnationTabContent").then((m) => ({
    default: m.StagnationTabContent,
  })),
);
const RetryTab = lazy(() =>
  import("@/components/admin/queue-cockpit/RetryLoopTabContent").then((m) => ({
    default: m.RetryLoopTabContent,
  })),
);
const AuditTab = lazy(() =>
  import("@/components/admin/queue-cockpit/BypassAuditTabContent").then((m) => ({
    default: m.BypassAuditTabContent,
  })),
);
const ExplainTab = lazy(() =>
  import("@/components/admin/queue-cockpit/IntegrityExplainTabContent").then((m) => ({
    default: m.IntegrityExplainTabContent,
  })),
);
const HealingWizardTab = lazy(() =>
  import("@/components/admin/queue-cockpit/HealingWizardTabContent").then((m) => ({
    default: m.HealingWizardTabContent,
  })),
);

const QUEUE_SUBTABS = [
  { value: "live", label: "Live", icon: Activity, hint: "Aktive Jobs in Echtzeit" },
  { value: "heal", label: "Heal-Worklist", icon: Stethoscope, hint: "Smart-Heal-Worklist" },
  { value: "wizard", label: "Wizard", icon: Wand2, hint: "Geführter Heal-Wizard + Timeline" },
  { value: "stuck", label: "Stuck", icon: AlertTriangle, hint: "Festgefahrene Pipeline-Steps" },
  { value: "repair", label: "Repair", icon: Wrench, hint: "Geplante Reparatur-Jobs" },
  { value: "stagnation", label: "Stagnation", icon: ListChecks, hint: "Cooldown-/Backoff-Stagnation" },
  { value: "retry", label: "Retry-Loops", icon: RefreshCw, hint: "Endlosschleifen-Detektor" },
  { value: "explain", label: "Explain", icon: Filter, hint: "Integrity Explain Mode" },
  { value: "audit", label: "Audit", icon: Shield, hint: "Bypass / Force-Done Audit" },
] as const;

type QueueSubTab = (typeof QUEUE_SUBTABS)[number]["value"];
const VALID_QUEUE_SUBTABS = new Set<string>(QUEUE_SUBTABS.map((t) => t.value));

const LoadingFallback = () => (
  <div className="space-y-3 py-4">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-32 w-full" />
  </div>
);

const SECTIONS = {
  live: "live",
  recover: "recover",
  targeted: "targeted",
  stuck: "stuck_patterns",
  heal_status: "heal_status",
  triage: "triage",
  recheck: "recheck",
  drilldown: "drilldown",
  selector: "selector",
  reaper: "reaper",
  strategy: "strategy",
  queue: "queue",
} as const;

const DEFAULT_OPEN = ["live", "recover", "targeted", "stuck_patterns", "heal_status"];

export default function HealCockpitPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<BlockerKey | "ALL">("ALL");

  const rawSubtab = params.get("queue_tab");
  const queueSubtab: QueueSubTab =
    rawSubtab && VALID_QUEUE_SUBTABS.has(rawSubtab) ? (rawSubtab as QueueSubTab) : "live";

  const setQueueSubtab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set("queue_tab", v);
    setParams(next, { replace: true });
  };

  const refreshAll = () => {
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-4 max-w-[1500px] mx-auto pb-12">
      <AdminPageHeader
        icon={Heart}
        title="Heal Cockpit"
        description="SSOT-Hub für alle Recovery-, Repair-, Reaper- und Queue-Heal-Funktionen"
        documentTitle="Heal Cockpit · Admin"
        metaDescription="Konsolidierter Steuerstand für Stale-Reaper, Hot-Loop-Quarantäne, Targeted Recheck, Track-Normalize, Heal-Strategien und Live-Queue."
        actions={
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh All
          </Button>
        }
      />

      {/* Top-of-page alerts (always visible) */}
      <AlertsBanner />

      <Accordion
        type="multiple"
        defaultValue={DEFAULT_OPEN}
        className="space-y-2"
      >
        {/* 1 — Live Pulse */}
        <AccordionItem value={SECTIONS.live} className="border rounded-lg bg-card px-4">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Activity}
              step={1}
              title="Live Pulse"
              hint="Throughput v2 · Publish-Blocker Counts"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-3">
            <ThroughputCard windowHours={6} />
            <BlockerCountsCard filter={filter} onFilterChange={setFilter} />
          </AccordionContent>
        </AccordionItem>

        {/* 2 — Recover */}
        <AccordionItem value={SECTIONS.recover} className="border rounded-lg bg-card px-4">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Wand2}
              step={2}
              title="Recover Actions"
              hint="Stale-Reap · Hot-Loop Quarantäne (mit Whitelist)"
              tone="destructive"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-3">
            <RecoverActionsCard />
            <QueueDrainCard />
          </AccordionContent>
        </AccordionItem>

        {/* 3 — Targeted Heal (Hotloop + Hollow + Blocked) */}
        <AccordionItem value={SECTIONS.targeted} className="border rounded-lg bg-card px-4 border-warning/30">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Stethoscope}
              step={3}
              title="Targeted Heal"
              hint="Promote-Hotloop · Hollow-Published · Blocked-Packages — nachhaltige Bulk-Heilung"
              tone="destructive"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-3">
            <TargetedHealCard />
            <BlockedPackagesCard />
          </AccordionContent>
        </AccordionItem>

        {/* 3b — Stuck-Patterns Dashboard */}
        <AccordionItem value={SECTIONS.stuck} className="border rounded-lg bg-card px-4 border-primary/30">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Crosshair}
              step={3}
              title="Stuck-Patterns Dashboard"
              hint="Hidden Drafts · Queued-without-Jobs · Reentry-Guard — priorisiert pro Track"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-3">
            <StuckPatternsCard />
          </AccordionContent>
        </AccordionItem>

        {/* 3c — Heal-Status pro Kurs/Track + Per-Step-Retry + Auto-Heal-Plan */}
        <AccordionItem value={SECTIONS.heal_status} className="border rounded-lg bg-card px-4 border-primary/30">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Heart}
              step={3}
              title="Heal-Status pro Kurs/Track"
              hint="Vorher/Geheilt/Fehlgeschlagen · Per-Step-Retry · Auto-Heal-Plan mit Job-Block-Check"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4 space-y-3">
            <HealStatusCard />
          </AccordionContent>
        </AccordionItem>

        {/* 4 — Triage */}
        <AccordionItem value={SECTIONS.triage} className="border rounded-lg bg-card px-4">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Crosshair}
              step={4}
              title="Triage"
              hint="Failed-Cluster · Blocker-Split · Hollow · Track-Normalize"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <TriageCards />
          </AccordionContent>
        </AccordionItem>

        {/* 4 — Targeted Recheck */}
        <AccordionItem value={SECTIONS.recheck} className="border rounded-lg bg-card px-4">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Stethoscope}
              step={4}
              title="Targeted Blocker Recheck"
              hint="Cause-aware Re-Enqueue · 4 Blocker-Klassen · Before/After Snapshot"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <TargetedRecheckCard />
          </AccordionContent>
        </AccordionItem>

        {/* 5 — Drill-down */}
        <AccordionItem value={SECTIONS.drilldown} className="border rounded-lg bg-card px-4">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Filter}
              step={5}
              title="Drill-down"
              hint={filter === "ALL" ? "Alle blockierten Pakete" : `Filter: ${filter}`}
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <DrillDownCard filter={filter} onResetFilter={() => setFilter("ALL")} />
          </AccordionContent>
        </AccordionItem>

        {/* 6 — Auto-Selector */}
        <AccordionItem value={SECTIONS.selector} className="border rounded-lg bg-card px-4">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Wand2}
              step={6}
              title="Exam-Pool Auto-Selector"
              hint="Per-Paket Repair-Recommendation"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <AutoSelectorCard />
          </AccordionContent>
        </AccordionItem>

        {/* 7 — Reaper Governance */}
        <AccordionItem value={SECTIONS.reaper} className="border rounded-lg bg-card px-4">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Settings}
              step={7}
              title="Reaper Governance"
              hint="Config · Manual Run · Audit-Log"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <ReaperGovernanceCard />
          </AccordionContent>
        </AccordionItem>

        {/* 8 — Strategien */}
        <AccordionItem value={SECTIONS.strategy} className="border rounded-lg bg-card px-4">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={Shield}
              step={8}
              title="Heal-Strategien"
              hint="Auto-Repair Toggles für Integrity-Reasons"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <HealStrategyCard />
          </AccordionContent>
        </AccordionItem>

        {/* 9 — Queue Detail Tabs */}
        <AccordionItem value={SECTIONS.queue} className="border rounded-lg bg-card px-4">
          <AccordionTrigger className="hover:no-underline">
            <SectionTitle
              icon={ListChecks}
              step={9}
              title="Queue Detail-Tabs"
              hint="Live-Jobs · Heal-Worklist · Wizard · Stuck · Repair · Stagnation · Retry · Audit · Explain"
            />
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <Tabs value={queueSubtab} onValueChange={setQueueSubtab} className="w-full">
              <Card className="p-1">
                <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-transparent p-0">
                  {QUEUE_SUBTABS.map((t) => (
                    <TabsTrigger
                      key={t.value}
                      value={t.value}
                      title={t.hint}
                      className="flex-1 min-w-[7rem] gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
                    >
                      <t.icon className="h-3.5 w-3.5" />
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Card>

              <TabsContent value="live" className="mt-4">
                <Suspense fallback={<LoadingFallback />}><QueueLiveTab /></Suspense>
              </TabsContent>
              <TabsContent value="heal" className="mt-4">
                <Suspense fallback={<LoadingFallback />}><HealTab /></Suspense>
              </TabsContent>
              <TabsContent value="wizard" className="mt-4">
                <Suspense fallback={<LoadingFallback />}><HealingWizardTab /></Suspense>
              </TabsContent>
              <TabsContent value="stuck" className="mt-4">
                <Suspense fallback={<LoadingFallback />}><StuckTab /></Suspense>
              </TabsContent>
              <TabsContent value="repair" className="mt-4">
                <Suspense fallback={<LoadingFallback />}><RepairTab /></Suspense>
              </TabsContent>
              <TabsContent value="stagnation" className="mt-4">
                <Suspense fallback={<LoadingFallback />}><StagnationTab /></Suspense>
              </TabsContent>
              <TabsContent value="retry" className="mt-4">
                <Suspense fallback={<LoadingFallback />}><RetryTab /></Suspense>
              </TabsContent>
              <TabsContent value="explain" className="mt-4">
                <Suspense fallback={<LoadingFallback />}><ExplainTab /></Suspense>
              </TabsContent>
              <TabsContent value="audit" className="mt-4">
                <Suspense fallback={<LoadingFallback />}><AuditTab /></Suspense>
              </TabsContent>
            </Tabs>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function SectionTitle({
  icon: Icon, step, title, hint, tone,
}: {
  icon: any; step: number; title: string; hint: string; tone?: "destructive";
}) {
  return (
    <div className="flex items-center gap-3 flex-1 text-left">
      <Badge
        variant={tone === "destructive" ? "destructive" : "outline"}
        className="text-[10px] tabular-nums shrink-0 h-5 px-1.5"
      >
        {step}
      </Badge>
      <Icon className="h-4 w-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{title}</div>
        <div className="text-[11px] text-muted-foreground font-normal truncate">{hint}</div>
      </div>
    </div>
  );
}
