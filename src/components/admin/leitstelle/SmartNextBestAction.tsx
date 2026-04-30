/**
 * SmartNextBestAction
 * ───────────────────
 * Analysiert SSOT-Echtzeitdaten und berechnet eine priorisierte Top-3-Liste
 * der wertvollsten nächsten Heal-/Publish-/Repair-Aktionen.
 *
 * Heuristik (Priorität ↓):
 *   1. Pakete die "release_ok" sind aber noch building → Soft-Heal/Publish
 *      (entgangener SEO-/Umsatz-Impact, hoher ROI, niedriges Risiko)
 *   2. Stuck Pakete mit klarem Heal-Pfad (auto-fähig)
 *   3. Zombie-Jobs > 0 → Bulk Kill (System-Hygiene)
 *   4. Failed Jobs mit retriable Tail (>5) → Bulk Requeue
 *
 * Jede Karte enthält:
 *   - Impact-Schätzung (Anzahl Pakete, geschätzter SEO-Wert)
 *   - Risk-Tag (low/med/high)
 *   - Ein-Klick-Aktion (Link → Queue-Tab oder direkter Run)
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles,
  Rocket,
  Wrench,
  Skull,
  RefreshCcw,
  ArrowRight,
  TrendingUp,
} from "lucide-react";
import { useAdminPackagesSSOT } from "@/hooks/useAdminPackagesSSOT";
import { useAdminQueueSSOT } from "@/hooks/useAdminQueueSSOT";
import { usePublishReadiness } from "@/hooks/usePublishReadiness";
import { cn } from "@/lib/utils";

type Risk = "low" | "med" | "high";

interface NextAction {
  id: string;
  title: string;
  reason: string;
  impact: string;
  risk: Risk;
  icon: React.ComponentType<{ className?: string }>;
  toneClass: string;
  cta: string;
  href: string;
}

const RISK_BADGE: Record<Risk, string> = {
  low: "bg-success/10 text-success border-success/30",
  med: "bg-warning/10 text-warning border-warning/30",
  high: "bg-destructive/10 text-destructive border-destructive/30",
};

const RISK_LABEL: Record<Risk, string> = {
  low: "Niedriges Risiko",
  med: "Mittleres Risiko",
  high: "Höheres Risiko",
};

export function SmartNextBestAction() {
  const { data: packages, isLoading: pkgL } = useAdminPackagesSSOT();
  const { data: jobs, isLoading: jobL } = useAdminQueueSSOT();
  // Kanonische DB-Regel via View v_admin_publish_readiness (publish_ready + is_published)
  const { data: readiness, isLoading: readyL } = usePublishReadiness();

  const actions = useMemo<NextAction[]>(() => {
    if (!packages || !jobs || !readiness) return [];
    const out: NextAction[] = [];

    // 1) Bereit zur Veröffentlichung — SSOT-Quelle: v_admin_publish_readiness
    //    publish_ready = true UND is_published = false (siehe View-Definition).
    //    Frühere Heuristik (council_approved + !is_published + !blocked_reason)
    //    war approximativ und divergierte von der DB-Wahrheit.
    // SSOT-Härtung: View-Field is_published kann gegen course_packages.status driften.
    // Wir schließen Pakete deren package_status bereits 'published' ist explizit aus,
    // damit Phantom-Counts (44 published-Pakete in „ready"-Liste) nicht mehr auftauchen.
    const readyToPublish = readiness.filter(
      (r: any) =>
        r.publish_ready === true &&
        r.is_published !== true &&
        r.package_status !== "published",
    );
    if (readyToPublish.length > 0) {
      out.push({
        id: "publish-ready",
        title: `${readyToPublish.length} Paket(e) bereit zur Veröffentlichung`,
        reason:
          "Council approved, keine Blocker, keine Drift — aber noch nicht published. Direkter SEO-/Umsatz-Verlust.",
        impact: `~+${(readyToPublish.length * 1200).toLocaleString("de-DE")} mtl. organische Visits (geschätzt)`,
        risk: "low",
        icon: Rocket,
        toneClass: "border-success/30 bg-success/5",
        cta: "Publish-Workflow öffnen",
        href: "/admin/queue?tab=heal",
      });
    }

    // 2) Stuck Pakete mit klarem Heal-Pfad
    const stuck = packages.filter((p) => p.is_stuck);
    if (stuck.length > 0) {
      out.push({
        id: "stuck-heal",
        title: `${stuck.length} festgefahrene(s) Paket(e) heilen`,
        reason: "Smart-Heal-Worklist erkennt automatisch Heal-Pfad (Soft- oder Hard-Heal).",
        impact: stuck.length > 3 ? `Entlastet Pipeline + ${stuck.length} Pakete weiter` : "Pipeline-Hygiene",
        risk: stuck.length > 5 ? "med" : "low",
        icon: Wrench,
        toneClass: "border-warning/30 bg-warning/5",
        cta: "Heal-Worklist öffnen",
        href: "/admin/queue?tab=heal",
      });
    }

    // 3) Zombie-Jobs (Stuck Processing)
    const zombies = jobs.filter((j) => j.health_signal === "zombie");
    if (zombies.length > 0) {
      out.push({
        id: "zombie-kill",
        title: `${zombies.length} Zombie-Job(s) terminieren`,
        reason: "Jobs hängen seit > Threshold im Status processing ohne Fortschritt.",
        impact: "Befreit Worker-Slots, beschleunigt Queue-Durchsatz",
        risk: "low",
        icon: Skull,
        toneClass: "border-destructive/30 bg-destructive/5",
        cta: "Live-Queue öffnen",
        href: "/admin/queue?tab=live",
      });
    }

    // 4) Failed Tail (retriable)
    const failedRetriable = jobs.filter(
      (j) => j.job_status === "failed" && j.health_signal === "retriable",
    );
    if (failedRetriable.length >= 5) {
      out.push({
        id: "failed-requeue",
        title: `${failedRetriable.length} fehlgeschlagene Jobs erneut einreihen`,
        reason: "Transiente Fehler (HTTP 5xx, Timeouts) — Bulk-Requeue resolvet die meisten.",
        impact: "Beschleunigt Pipeline-Throughput",
        risk: "med",
        icon: RefreshCcw,
        toneClass: "border-warning/30 bg-warning/5",
        cta: "Live-Queue öffnen",
        href: "/admin/queue?tab=live",
      });
    }

    // 5) Repair-Queue voll
    const repairPending = jobs.filter(
      (j) =>
        j.job_status === "pending" && j.job_type.startsWith("package_repair_"),
    );
    if (repairPending.length >= 8) {
      out.push({
        id: "repair-queue",
        title: `${repairPending.length} Repair-Jobs in Queue`,
        reason: "Repair-Queue füllt sich — sicherstellen dass Worker-Pool bereit ist.",
        impact: "Verhindert Repair-Stau",
        risk: "med",
        icon: TrendingUp,
        toneClass: "border-primary/30 bg-primary/5",
        cta: "Repair-Tab öffnen",
        href: "/admin/queue?tab=repair",
      });
    }

    // Top-3 nach Reihenfolge (deterministisch — Priorität bereits oben)
    return out.slice(0, 3);
  }, [packages, jobs, readiness]);

  if (pkgL || jobL || readyL) {
    return (
      <Card className="p-4 space-y-3">
        <Skeleton className="h-5 w-48" />
        <div className="grid gap-2 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </Card>
    );
  }

  if (actions.length === 0) {
    return (
      <Card className="p-4 border-success/30 bg-success/5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-success" />
          <span className="text-sm font-medium text-foreground">
            Alles im grünen Bereich — keine kritischen Aktionen erforderlich.
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">
          Smart Next-Best-Action
        </h2>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono">
          ROI-priorisiert
        </Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {actions.map((a) => (
          <div
            key={a.id}
            className={cn(
              "rounded-xl border p-3 space-y-2 flex flex-col",
              a.toneClass,
            )}
          >
            <div className="flex items-start gap-2">
              <a.icon className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground leading-tight">
                  {a.title}
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">
              {a.reason}
            </p>
            <div className="text-[11px] text-foreground/80 font-medium">
              💡 {a.impact}
            </div>
            <div className="flex items-center justify-between mt-auto pt-1">
              <Badge
                variant="outline"
                className={cn("text-[9px] h-4 px-1.5", RISK_BADGE[a.risk])}
                title={RISK_LABEL[a.risk]}
              >
                {RISK_LABEL[a.risk]}
              </Badge>
              <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                <Link to={a.href}>
                  {a.cta}
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
