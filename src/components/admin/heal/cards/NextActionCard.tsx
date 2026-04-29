/**
 * NextActionCard — "Was jetzt klicken?"
 *
 * Deterministische Empfehlung basierend auf Lane-Health:
 * - Worker-Stillstand (pending>0, processing=0, completed_6h=0)  → Reap-Lane
 * - DAG-Backlog (pending>0, processing>0, completed_6h=0)        → Per-Step-Retry der blockierenden Tail-Steps
 * - slow drain (oldest > 1h)                                     → Stuck-Patterns Bulk-Promote
 * - alles grün                                                   → "Nichts zu tun"
 *
 * Reine UI-Logik, keine neuen RPCs. Verlinkt per onClick auf
 * vorhandene Aktionen über window-Events / smooth-scroll.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertTriangle, ArrowRight, Compass } from "lucide-react";
import { cn } from "@/lib/utils";

interface LaneRow {
  lane: string;
  pending_cnt: number;
  processing_cnt: number;
  queued_cnt: number;
  last_completed_at: string | null;
  completed_6h: number;
  oldest_pending_sec: number | null;
}

type Severity = "ok" | "info" | "warn" | "critical";

interface Recommendation {
  severity: Severity;
  title: string;
  body: string;
  action?: { label: string; targetSelector?: string };
}

function buildRecommendation(lanes: LaneRow[]): Recommendation {
  const stalled: string[] = [];
  const dagBacklog: string[] = [];
  const slow: string[] = [];

  for (const l of lanes) {
    const noCompletions = l.pending_cnt > 0 && l.completed_6h === 0;
    if (noCompletions && l.processing_cnt === 0) stalled.push(l.lane);
    else if (noCompletions && l.processing_cnt > 0) dagBacklog.push(l.lane);
    else if ((l.oldest_pending_sec ?? 0) > 3600) slow.push(l.lane);
  }

  if (stalled.length > 0) {
    return {
      severity: "critical",
      title: `Worker-Stillstand: ${stalled.join(", ")}`,
      body:
        `Keine Jobs werden bearbeitet (processing=0, completed_6h=0). ` +
        `Klicke oben „Reap ${stalled.includes("control") ? "Control-Lane" : "All"}" um Zombie-Leases freizugeben.`,
      action: { label: "Zum Reap-Button (oben)", targetSelector: "[data-quick-reap]" },
    };
  }

  if (dagBacklog.length > 0) {
    return {
      severity: "warn",
      title: `DAG-Backlog: ${dagBacklog.join(", ")}`,
      body:
        `Worker leben (processing>0), aber Jobs werden gefiltert weil vorgelagerte Tail-Steps ` +
        `(meist package_run_integrity_check oder package_quality_council) failed/queued sind. ` +
        `→ Sektion „Pakete heilen" → „Heal-Status pro Kurs" → Per-Step-Retry auf der roten Zeile.`,
      action: { label: "Zu „Pakete heilen"", targetSelector: '[data-section="packages"]' },
    };
  }

  if (slow.length > 0) {
    return {
      severity: "info",
      title: `Slow drain: ${slow.join(", ")}`,
      body:
        `Pakete liegen >1h pending. Wenn das nicht von alleine drainen sollte, ` +
        `probiere „Pakete heilen" → „Stuck-Patterns" → Bulk-Promote.`,
      action: { label: "Zu Stuck-Patterns", targetSelector: '[data-section="packages"]' },
    };
  }

  return {
    severity: "ok",
    title: "Pipeline gesund",
    body: "Alle Lanes drainen, keine Aktion nötig. Live-Refresh läuft alle 30s.",
  };
}

const TONE: Record<Severity, { ring: string; text: string; badge: string; label: string; Icon: typeof CheckCircle2 }> = {
  ok:       { ring: "border-primary/40 bg-primary/5",       text: "text-primary",       badge: "bg-primary text-primary-foreground", label: "OK",       Icon: CheckCircle2 },
  info:     { ring: "border-muted-foreground/30 bg-muted/30", text: "text-foreground",  badge: "bg-muted text-foreground",            label: "INFO",     Icon: Compass },
  warn:     { ring: "border-warning/50 bg-warning/5",       text: "text-warning",       badge: "bg-warning text-warning-foreground",  label: "ACTION",   Icon: AlertTriangle },
  critical: { ring: "border-destructive/60 bg-destructive/5", text: "text-destructive", badge: "bg-destructive text-destructive-foreground", label: "URGENT", Icon: AlertTriangle },
};

function scrollTo(selector?: string) {
  if (!selector) return;
  const el = document.querySelector(selector);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    (el as HTMLElement).classList.add("ring-2", "ring-primary");
    setTimeout(() => (el as HTMLElement).classList.remove("ring-2", "ring-primary"), 1800);
  }
}

export function NextActionCard() {
  const q = useQuery({
    queryKey: ["admin-lane-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_lane_health" as any);
      if (error) throw error;
      return (data ?? []) as LaneRow[];
    },
    refetchInterval: 30_000,
  });

  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  const rec = buildRecommendation(q.data ?? []);
  const tone = TONE[rec.severity];

  return (
    <Card className={cn("p-4 border-2", tone.ring)}>
      <div className="flex items-start gap-3">
        <tone.Icon className={cn("h-6 w-6 shrink-0 mt-0.5", tone.text)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge className={cn("text-[10px]", tone.badge)}>{tone.label} · NÄCHSTER SCHRITT</Badge>
            <span className={cn("font-semibold text-sm", tone.text)}>{rec.title}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{rec.body}</p>
          {rec.action && (
            <Button
              size="sm"
              variant={rec.severity === "critical" ? "destructive" : "outline"}
              className="mt-2 h-7 text-xs"
              onClick={() => scrollTo(rec.action?.targetSelector)}
            >
              {rec.action.label} <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
