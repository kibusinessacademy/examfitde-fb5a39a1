/**
 * Unified Queue Cockpit (SSOT v2)
 * ───────────────────────────────
 * SSOT-Hub für ALLE operativen Queue-/Heal-/Repair-/Audit-Aktionen.
 *
 * Tabs (deep-linkable via ?tab=…):
 *   1. live      — Original QueuePage (Live-Job-Liste + Cockpit-Header)
 *   2. heal      — Heal-Worklist + Briefing + Cluster + Blocked Packages
 *   3. stuck     — Pending-Enqueue Observability
 *   4. repair    — Per-Kurs Repair-Queue (Coverage + Stall-Diagnose)
 *   5. stagnation — Stagnation/REQUEUE-Loop Cluster
 *   6. retry     — Retry-Loop Detector
 *   7. audit     — Bypass / Force-Done Audit
 *
 * v2-Änderungen:
 *   • Tab-Inhalte werden aus dedizierten Content-Komponenten geladen
 *     (kein doppelter <Helmet> mehr → kein Race auf classList.add).
 *   • Header/Card-Pattern via AdminPageHeader vereinheitlicht.
 *   • Legacy-Pages wurden ersatzlos entfernt — alte Routen redirecten hierher.
 */
import { lazy, Suspense, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ListChecks,
  Stethoscope,
  Activity,
  Wrench,
  Hourglass,
  RefreshCcw,
  Shield,
  Settings,
  Search,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/v2/AdminPageHeader";

// Live-Tab kommt aus der bestehenden QueuePage — sie hat kein eigenes Helmet
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

const TABS = [
  { value: "live", label: "Live", icon: Activity, hint: "Aktive Jobs in Echtzeit" },
  { value: "heal", label: "Heal", icon: Stethoscope, hint: "Smart-Heal-Worklist" },
  { value: "stuck", label: "Stuck", icon: Hourglass, hint: "Festgefahrene Pipeline-Steps" },
  { value: "repair", label: "Repair", icon: Wrench, hint: "Geplante Reparatur-Jobs" },
  { value: "stagnation", label: "Stagnation", icon: ListChecks, hint: "Cooldown-/Backoff-Stagnation" },
  { value: "retry", label: "Retry-Loops", icon: RefreshCcw, hint: "Endlosschleifen-Detektor" },
  { value: "explain", label: "Explain", icon: Search, hint: "Integrity Explain Mode + BP-Audit" },
  { value: "wizard", label: "Heal-Wizard", icon: Stethoscope, hint: "Geführter Job-Healing Wizard + Timeline + 503-Diagnose + Audit" },
  { value: "audit", label: "Audit", icon: Shield, hint: "Bypass / Force-Done Audit" },
] as const;

const LoadingFallback = () => (
  <div className="space-y-3 py-4">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-32 w-full" />
    <Skeleton className="h-32 w-full" />
  </div>
);

type TabValue = (typeof TABS)[number]["value"];
const VALID_TABS: ReadonlySet<TabValue> = new Set(TABS.map((t) => t.value));
const DEFAULT_TAB: TabValue = "live";

function isValidTab(v: string | null | undefined): v is TabValue {
  return !!v && (VALID_TABS as ReadonlySet<string>).has(v);
}

export default function UnifiedQueueCockpit() {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab");
  const tab: TabValue = isValidTab(rawTab) ? rawTab : DEFAULT_TAB;

  // Normalisiere ungültige/fehlende Tabs deterministisch auf "live".
  // Idempotent: nur schreiben wenn der URL-Wert wirklich abweicht — kein Loop.
  useEffect(() => {
    if (rawTab !== DEFAULT_TAB && !isValidTab(rawTab)) {
      const next = new URLSearchParams(params);
      next.set("tab", DEFAULT_TAB);
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTab]);

  const setTab = (v: string) => {
    const safe: TabValue = isValidTab(v) ? v : DEFAULT_TAB;
    const next = new URLSearchParams(params);
    next.set("tab", safe);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        icon={ListChecks}
        title="Queue Cockpit"
        description="SSOT für Live-Jobs, Heal, Stuck-Steps, Repair, Stagnation, Retry-Loops & Audit"
        documentTitle="Queue Cockpit · Admin"
        metaDescription="Unified Admin Queue Cockpit – Live-Jobs, Heal-Worklist, Stuck-Steps, Repair-Queue, Stagnation, Retry-Loops und Audit in einer Ansicht."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/ops/heal-settings">
              <Settings className="h-4 w-4 mr-1.5" />
              Heal-Strategie
            </Link>
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <Card className="p-1">
          <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-transparent p-0">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                title={t.hint}
                className="flex-1 min-w-[8rem] gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Card>

        <TabsContent value="live" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <QueueLiveTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="heal" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <HealTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="stuck" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <StuckTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="repair" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <RepairTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="stagnation" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <StagnationTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="retry" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <RetryTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="explain" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <ExplainTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="wizard" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <HealingWizardTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <AuditTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
