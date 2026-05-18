import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, Timer, Brain, ShieldCheck, LogIn, PlayCircle } from "lucide-react";

/**
 * Post-Purchase Activation Cockpit (Cut 1a)
 *
 * Quelle: admin_get_post_purchase_activation_summary (SECURITY DEFINER, has_role admin).
 * Funnel: paid → first_login → first_session → first_question → first_lesson → first_exam.
 * KPIs: Conversion-Pcte pro Stage + Time-to-First-Value p50/p90/p95.
 */

type Summary = {
  window_hours: number;
  generated_at: string;
  total_paid: number;
  funnel: {
    paid: number;
    first_login: number;
    first_session: number;
    first_question: number;
    first_lesson_done: number;
    first_exam_started: number;
  };
  time_to: {
    ttfv_p50_sec: number | null;
    ttfv_p90_sec: number | null;
    ttfv_p95_sec: number | null;
    login_p50_sec: number | null;
    session_p50_sec: number | null;
    lesson_p50_sec: number | null;
    exam_p50_sec: number | null;
  };
  by_track: Array<{ track: string; paid: number; first_value: number; first_exam: number; first_value_pct: number | null }>;
  by_persona: Array<{ persona: string; paid: number; first_value: number; first_value_pct: number | null }>;
};

const WINDOWS: { value: number; label: string }[] = [
  { value: 24, label: "24h" },
  { value: 168, label: "7d" },
  { value: 720, label: "30d" },
];

function fmtDuration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}min`;
  if (sec < 86_400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86_400).toFixed(1)}d`;
}

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((100 * n) / d);
}

function StageBar({
  icon,
  label,
  count,
  base,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  base: number;
  tone: "petrol" | "mint" | "warn";
}) {
  const ratio = pct(count, base);
  const toneCls =
    tone === "mint"
      ? "bg-mint-500"
      : tone === "warn"
      ? "bg-status-warning-fg"
      : "bg-petrol-900";
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
            paid → first_login → first_session → first_question → first_lesson → first_exam
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
        ) : !data || data.total_paid === 0 ? (
          <div className="rounded-md border border-border bg-surface-muted/40 p-4 text-sm text-text-tertiary">
            Noch keine Käufe in diesem Zeitfenster.
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Käufer" value={data.funnel.paid.toLocaleString()} />
              <Kpi
                label="First-Value-Rate"
                value={`${pct(data.funnel.first_question, data.funnel.paid)}%`}
                hint="erste Frage beantwortet"
              />
              <Kpi
                label="TTFV p50"
                value={fmtDuration(data.time_to.ttfv_p50_sec)}
                hint={`p90 ${fmtDuration(data.time_to.ttfv_p90_sec)}`}
              />
              <Kpi
                label="Exam-Start-Rate"
                value={`${pct(data.funnel.first_exam_started, data.funnel.paid)}%`}
              />
            </div>

            {/* Funnel */}
            <div className="space-y-3 rounded-lg border border-border p-4">
              <StageBar
                icon={<ShieldCheck className="h-3.5 w-3.5" />}
                label="paid"
                count={data.funnel.paid}
                base={data.funnel.paid}
                tone="petrol"
              />
              <StageBar
                icon={<LogIn className="h-3.5 w-3.5" />}
                label="first_login"
                count={data.funnel.first_login}
                base={data.funnel.paid}
                tone="petrol"
              />
              <StageBar
                icon={<PlayCircle className="h-3.5 w-3.5" />}
                label="first_session"
                count={data.funnel.first_session}
                base={data.funnel.paid}
                tone="petrol"
              />
              <StageBar
                icon={<Brain className="h-3.5 w-3.5" />}
                label="first_question (first value)"
                count={data.funnel.first_question}
                base={data.funnel.paid}
                tone="mint"
              />
              <StageBar
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="first_lesson_done"
                count={data.funnel.first_lesson_done}
                base={data.funnel.paid}
                tone="mint"
              />
              <StageBar
                icon={<Timer className="h-3.5 w-3.5" />}
                label="first_exam_started"
                count={data.funnel.first_exam_started}
                base={data.funnel.paid}
                tone="mint"
              />
            </div>

            {/* Drilldowns */}
            <div className="grid gap-4 md:grid-cols-2">
              <Drilldown
                title="Nach Track"
                rows={data.by_track.slice(0, 6).map((r) => ({
                  key: r.track,
                  paid: r.paid,
                  value: r.first_value,
                  pct: r.first_value_pct,
                }))}
              />
              <Drilldown
                title="Nach Persona"
                rows={data.by_persona.slice(0, 6).map((r) => ({
                  key: r.persona,
                  paid: r.paid,
                  value: r.first_value,
                  pct: r.first_value_pct,
                }))}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
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

function Drilldown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; paid: number; value: number; pct: number | null }>;
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2 text-xs font-medium text-text-secondary">
        {title}
      </div>
      <div className="divide-y divide-border">
        {rows.length === 0 ? (
          <div className="p-3 text-xs text-text-tertiary">Keine Daten.</div>
        ) : (
          rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
            >
              <span className="truncate font-medium text-text-primary">{r.key}</span>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="font-mono">
                  {r.value}/{r.paid}
                </Badge>
                <span className="w-10 text-right font-mono text-text-tertiary">
                  {r.pct ?? 0}%
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
