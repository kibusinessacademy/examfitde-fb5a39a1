import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, Sparkles, Brain, ShieldCheck, MessageSquare, Target, PlayCircle,
} from "lucide-react";

/**
 * Post-Purchase Activation Cockpit (Cut 1b)
 *
 * Quelle: admin_get_post_purchase_activation_summary (SECURITY DEFINER, admin only).
 * Funnel (echter Aha-Loop): paid → welcome_seen → minicheck_started →
 * minicheck_completed → tutor_feedback → lernplan_started.
 * KPIs: Completion-Rate, Tutor-Feedback-Rate, Lernplan-Rate, TTFV p50/p90.
 */

type Summary = {
  window_hours: number;
  total_buyers: number;
  funnel: {
    paid: number;
    welcome_seen: number;
    minicheck_started: number;
    minicheck_completed: number;
    tutor_feedback: number;
    lernplan_started: number;
  };
  ttfv_completed_sec: {
    p50: number | null;
    p90: number | null;
    p95: number | null;
  };
  completion_rate_pct: number;
  tutor_feedback_rate_pct: number;
  lernplan_rate_pct: number;
  dropoffs: {
    welcome_to_minicheck_started_pct: number | null;
    started_to_completed_pct: number | null;
    completed_to_tutor_pct: number | null;
    tutor_to_lernplan_pct: number | null;
  };
};

const WINDOWS: { value: number; label: string }[] = [
  { value: 24, label: "24h" },
  { value: 168, label: "7d" },
  { value: 720, label: "30d" },
];

function fmtDuration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}min`;
  if (sec < 86_400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86_400).toFixed(1)}d`;
}

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((100 * n) / d);
}

function StageBar({
  icon, label, count, base, tone,
}: {
  icon: React.ReactNode; label: string; count: number; base: number;
  tone: "petrol" | "mint" | "warn";
}) {
  const ratio = pct(count, base);
  const toneCls =
    tone === "mint" ? "bg-mint-500" :
    tone === "warn" ? "bg-status-warning-fg" :
    "bg-petrol-900";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1.5 text-text-secondary">
          {icon} {label}
        </span>
        <span className="font-mono text-text-primary">
          {count.toLocaleString()} <span className="text-text-tertiary">({ratio}%)</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
        <div className={`h-full ${toneCls}`} style={{ width: `${Math.min(100, ratio)}%` }} />
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-text-tertiary">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-text-primary">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-text-tertiary">{hint}</div>}
    </div>
  );
}

export function PostPurchaseActivationCard() {
  const [windowHours, setWindowHours] = useState(168);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin", "post-purchase-activation", windowHours],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_post_purchase_activation_summary" as any,
        { _window_hours: windowHours },
      );
      if (error) throw error;
      return data as unknown as Summary;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Post-Purchase Activation Funnel</CardTitle>
          <p className="mt-0.5 text-xs text-text-tertiary">
            paid → welcome → MiniCheck → Aha (Tutor) → Lernplan
          </p>
        </div>
        <Tabs value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
          <TabsList className="h-7">
            {WINDOWS.map((w) => (
              <TabsTrigger key={w.value} value={String(w.value)} className="text-xs h-6 px-2">
                {w.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
          </div>
        ) : isError ? (
          <div className="text-sm text-status-error-fg">
            Fehler: {(error as Error)?.message ?? "unknown"}
          </div>
        ) : !data || data.total_buyers === 0 ? (
          <div className="rounded-md border border-border bg-surface-muted/40 p-4 text-sm text-text-tertiary">
            Noch keine Käufe in diesem Zeitfenster.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Käufer" value={data.total_buyers.toLocaleString()} />
              <Kpi
                label="Completion-Rate"
                value={`${data.completion_rate_pct}%`}
                hint="MiniCheck abgeschlossen"
              />
              <Kpi
                label="TTFV p50"
                value={fmtDuration(data.ttfv_completed_sec.p50)}
                hint={`p90 ${fmtDuration(data.ttfv_completed_sec.p90)}`}
              />
              <Kpi
                label="Lernplan-Rate"
                value={`${data.lernplan_rate_pct}%`}
                hint={`Tutor ${data.tutor_feedback_rate_pct}%`}
              />
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <StageBar
                icon={<ShieldCheck className="h-3.5 w-3.5" />}
                label="paid"
                count={data.funnel.paid}
                base={data.funnel.paid}
                tone="petrol"
              />
              <StageBar
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="welcome_seen"
                count={data.funnel.welcome_seen}
                base={data.funnel.paid}
                tone="petrol"
              />
              <StageBar
                icon={<PlayCircle className="h-3.5 w-3.5" />}
                label="minicheck_started"
                count={data.funnel.minicheck_started}
                base={data.funnel.paid}
                tone="petrol"
              />
              <StageBar
                icon={<Brain className="h-3.5 w-3.5" />}
                label="minicheck_completed (first value)"
                count={data.funnel.minicheck_completed}
                base={data.funnel.paid}
                tone="mint"
              />
              <StageBar
                icon={<MessageSquare className="h-3.5 w-3.5" />}
                label="tutor_feedback"
                count={data.funnel.tutor_feedback}
                base={data.funnel.paid}
                tone="mint"
              />
              <StageBar
                icon={<Target className="h-3.5 w-3.5" />}
                label="lernplan_started"
                count={data.funnel.lernplan_started}
                base={data.funnel.paid}
                tone="mint"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <Kpi
                label="Welcome→Start"
                value={data.dropoffs.welcome_to_minicheck_started_pct != null
                  ? `${data.dropoffs.welcome_to_minicheck_started_pct}%` : "—"}
              />
              <Kpi
                label="Start→Done"
                value={data.dropoffs.started_to_completed_pct != null
                  ? `${data.dropoffs.started_to_completed_pct}%` : "—"}
              />
              <Kpi
                label="Done→Tutor"
                value={data.dropoffs.completed_to_tutor_pct != null
                  ? `${data.dropoffs.completed_to_tutor_pct}%` : "—"}
              />
              <Kpi
                label="Tutor→Lernplan"
                value={data.dropoffs.tutor_to_lernplan_pct != null
                  ? `${data.dropoffs.tutor_to_lernplan_pct}%` : "—"}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
