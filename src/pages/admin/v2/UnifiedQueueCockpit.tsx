/**
 * Unified Queue Cockpit (SSOT v1)
 * ───────────────────────────────
 * Ersetzt fragmentierte Admin-Hubs (Heal-Cockpit, Repair-Queue, Stuck-Steps,
 * Stagnation, Retry-Loop-Detector, Bypass-Audit) durch ein einziges Cockpit
 * mit Tabs. Alle Heal-Aktionen laufen über den bestehenden SSOT-Hook
 * `usePackageHealAction` / `runPackageHealAction`.
 *
 * Tabs:
 *   1. Live  — Original QueuePage (Live-Job-Liste + Cockpit-Header)
 *   2. Heal  — HealCockpit-Inhalt (Worklist + Briefing + Cluster)
 *   3. Stuck — Stuck Steps Dashboard
 *   4. Repair — Repair-Queue Dashboard
 *   5. Stagnation — Queue Stagnation
 *   6. Retry-Loops — Retry Loop Detector
 *   7. Audit  — Bypass / Step-Done Audit
 *
 * Tab kann via `?tab=` oder URL-Query gesteuert werden — Deep-Linking aus
 * Toasts und Drilldowns bleibt funktional.
 */
import { Helmet } from "react-helmet-async";
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
} from "lucide-react";

const QueueLiveTab = lazy(() => import("@/pages/admin/v2/QueuePage"));
const HealCockpitTab = lazy(() => import("@/pages/admin/v2/HealCockpitPage"));
const StuckStepsTab = lazy(() => import("@/pages/admin/v2/StuckStepsDashboardPage"));
const RepairQueueTab = lazy(() => import("@/pages/admin/v2/RepairQueueDashboardPage"));
const StagnationTab = lazy(() => import("@/pages/admin/v2/QueueStagnationPage"));
const RetryLoopTab = lazy(() => import("@/pages/admin/v2/RetryLoopDetectorPage"));
const BypassAuditTab = lazy(() => import("@/pages/admin/v2/BypassAuditPage"));

const TABS = [
  { value: "live", label: "Live", icon: Activity, hint: "Aktive Jobs in Echtzeit" },
  { value: "heal", label: "Heal", icon: Stethoscope, hint: "Smart-Heal-Worklist" },
  { value: "stuck", label: "Stuck", icon: Hourglass, hint: "Festgefahrene Pipeline-Steps" },
  { value: "repair", label: "Repair", icon: Wrench, hint: "Geplante Reparatur-Jobs" },
  { value: "stagnation", label: "Stagnation", icon: ListChecks, hint: "Cooldown-/Backoff-Stagnation" },
  { value: "retry", label: "Retry-Loops", icon: RefreshCcw, hint: "Endlosschleifen-Detektor" },
  { value: "audit", label: "Audit", icon: Shield, hint: "Bypass / Force-Done Audit" },
] as const;

const LoadingFallback = () => (
  <div className="space-y-3 py-4">
    <Skeleton className="h-8 w-64" />
    <Skeleton className="h-32 w-full" />
    <Skeleton className="h-32 w-full" />
  </div>
);

export default function UnifiedQueueCockpit() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "live";

  // Wenn unbekannter Tab → fallback live (idempotent, kein Loop)
  useEffect(() => {
    if (!TABS.some((t) => t.value === tab)) {
      setParams({ tab: "live" }, { replace: true });
    }
  }, [tab, setParams]);

  return (
    <div className="space-y-4">
      <Helmet>
        <title>Queue Cockpit · Admin</title>
        <meta
          name="description"
          content="Unified Admin Queue Cockpit – Live-Jobs, Heal-Worklist, Stuck-Steps, Repair-Queue, Stagnation, Retry-Loops und Audit in einer Ansicht."
        />
      </Helmet>

      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Queue Cockpit</h1>
            <p className="text-xs text-muted-foreground">
              SSOT für Live-Jobs, Heal, Stuck-Steps, Repair, Stagnation, Retry-Loops & Audit
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/ops/heal-settings">
            <Settings className="h-4 w-4 mr-1.5" />
            Heal-Strategie
          </Link>
        </Button>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => setParams({ tab: v }, { replace: true })}
        className="w-full"
      >
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
            <HealCockpitTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="stuck" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <StuckStepsTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="repair" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <RepairQueueTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="stagnation" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <StagnationTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="retry" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <RetryLoopTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <Suspense fallback={<LoadingFallback />}>
            <BypassAuditTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
