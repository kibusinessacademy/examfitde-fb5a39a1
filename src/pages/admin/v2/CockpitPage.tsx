/**
 * Loop D — Admin Cockpit
 *
 * 6 Status-Ampeln (SEO, Funnel, CRM, Revenue, Learning, Pipeline) mit
 * Drilldowns, Auto-Refresh, History-Sparkline und Action-CTAs.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp,
  CircleDot, Database, Globe, GraduationCap, Loader2, RefreshCw, Sparkles,
  TrendingUp, Users, Wallet, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { IntegrityHealthBanner } from "@/components/admin/cockpit/IntegrityHealthBanner";
import { PublishBlockerClustersBanner } from "@/components/admin/cockpit/PublishBlockerClustersBanner";

type CockpitStatus = "green" | "yellow" | "red" | "grey";
type Domain = "seo" | "funnel" | "crm" | "revenue" | "learning" | "pipeline";

interface CockpitCard {
  domain: Domain;
  status: CockpitStatus;
  primary_kpi: string;
  primary_value: number;
  secondary: Record<string, number>;
  reasons: string[];
  cta?: string;
  route?: string;
}

interface CockpitResponse {
  as_of: string;
  cards: CockpitCard[];
}

const DOMAIN_META: Record<Domain, { label: string; icon: typeof Globe; description: string }> = {
  seo: { label: "SEO", icon: Globe, description: "Programmatische Sichtbarkeit & Indexierung" },
  funnel: { label: "Funnel", icon: TrendingUp, description: "Conversion-Events der letzten 24h" },
  crm: { label: "CRM", icon: Users, description: "Kontakte, Newsletter & Email-Versand" },
  revenue: { label: "Revenue", icon: Wallet, description: "Bezahlte Orders & Umsatz" },
  learning: { label: "Learning", icon: GraduationCap, description: "Aktive Lizenzen & AI-Tutor-Qualität" },
  pipeline: { label: "Pipeline", icon: Workflow, description: "Job-Queue & Build-Health" },
};

const STATUS_COLORS: Record<CockpitStatus, { ring: string; bg: string; dot: string; label: string }> = {
  green: { ring: "ring-success/40", bg: "bg-success-bg-subtle", dot: "bg-success", label: "Healthy" },
  yellow: { ring: "ring-warning/40", bg: "bg-warning-bg-subtle", dot: "bg-warning", label: "Warning" },
  red: { ring: "ring-destructive/40", bg: "bg-destructive-bg-subtle", dot: "bg-destructive", label: "Critical" },
  grey: { ring: "ring-muted-foreground/30", bg: "bg-muted/30", dot: "bg-muted-foreground", label: "No Data" },
};

const PRIMARY_KPI_FORMAT: Record<string, (v: number) => string> = {
  revenue_24h_eur: (v) => `€ ${v.toFixed(2)}`,
};

function formatPrimary(card: CockpitCard): string {
  const fmt = PRIMARY_KPI_FORMAT[card.primary_kpi];
  if (fmt) return fmt(card.primary_value);
  return Number.isFinite(card.primary_value) ? card.primary_value.toLocaleString("de-DE") : "—";
}

function humanizeKey(k: string): string {
  return k
    .replace(/_eur$/i, " (€)")
    .replace(/_pct$/i, " (%)")
    .replace(/_24h$/i, " 24h")
    .replace(/_7d$/i, " 7d")
    .replace(/_/g, " ");
}

export default function CockpitPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Domain | null>(null);

  const live = useQuery({
    queryKey: ["cockpit", "live"],
    queryFn: async (): Promise<CockpitResponse> => {
      const { data, error } = await supabase.rpc("get_cockpit_status" as any);
      if (error) throw error;
      return data as unknown as CockpitResponse;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const history = useQuery({
    queryKey: ["cockpit", "history-14d"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cockpit_daily_snapshots" as any)
        .select("snapshot_date, domain, status, primary_value")
        .gte("snapshot_date", new Date(Date.now() - 14 * 86400e3).toISOString().slice(0, 10))
        .order("snapshot_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ snapshot_date: string; domain: Domain; status: CockpitStatus; primary_value: number }>;
    },
    staleTime: 5 * 60_000,
  });

  const persist = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("persist_cockpit_daily_snapshot" as any);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Tages-Snapshot persistiert");
      qc.invalidateQueries({ queryKey: ["cockpit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Snapshot fehlgeschlagen"),
  });

  const cards = live.data?.cards ?? [];
  const counts = cards.reduce(
    (acc, c) => ((acc[c.status] = (acc[c.status] ?? 0) + 1), acc),
    {} as Record<CockpitStatus, number>,
  );
  const overall: CockpitStatus = counts.red ? "red" : counts.yellow ? "yellow" : counts.grey === 6 ? "grey" : "green";

  const sparkFor = (domain: Domain) =>
    (history.data ?? [])
      .filter((h) => h.domain === domain)
      .map((h) => ({ d: h.snapshot_date, v: Number(h.primary_value ?? 0), s: h.status }));

  return (
    <TooltipProvider>
      <div className="space-y-6 pb-12 max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>ExamFit Cockpit · Loop D</span>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono">SSOT</Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Status-Ampeln</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              SEO · Funnel · CRM · Revenue · Learning · Pipeline — Live & 14d-Trend
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border ring-1", STATUS_COLORS[overall].ring, STATUS_COLORS[overall].bg)}>
              <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", STATUS_COLORS[overall].dot)} />
              <span className="text-xs font-semibold">{STATUS_COLORS[overall].label}</span>
              {(counts.red || counts.yellow) ? (
                <span className="text-[10px] text-muted-foreground">
                  {counts.red ? `${counts.red} kritisch` : ""}
                  {counts.red && counts.yellow ? " · " : ""}
                  {counts.yellow ? `${counts.yellow} warn` : ""}
                </span>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["cockpit"] })}
              disabled={live.isFetching}
              className="gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", live.isFetching && "animate-spin")} />
              Aktualisieren
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => persist.mutate()}
              disabled={persist.isPending}
              className="gap-1.5"
            >
              {persist.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
              Snapshot speichern
            </Button>
          </div>
        </header>

        {/* Integrity Health — macht generischen INTEGRITY_FAILED Blocker transparent */}
        <IntegrityHealthBanner />

        {/* Publish-Blocker-Cluster — aggregierte Top-Level-Sicht */}
        <PublishBlockerClustersBanner />

        {live.isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="h-44 animate-pulse bg-muted/40" />
            ))}
          </div>
        )}

        {live.error && (
          <Card className="p-4 border-destructive/50 bg-destructive-bg-subtle">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Cockpit nicht erreichbar</div>
                <div className="text-muted-foreground">{(live.error as Error).message}</div>
              </div>
            </div>
          </Card>
        )}

        {/* 6 Cards */}
        {cards.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {cards.map((card) => {
              const meta = DOMAIN_META[card.domain];
              const colors = STATUS_COLORS[card.status];
              const Icon = meta.icon;
              const isOpen = expanded === card.domain;
              const spark = sparkFor(card.domain);
              return (
                <Card
                  key={card.domain}
                  className={cn(
                    "relative overflow-hidden border ring-1 transition-all",
                    colors.ring, colors.bg,
                    isOpen && "ring-2 shadow-lg",
                  )}
                >
                  {/* Top stripe */}
                  <div className={cn("absolute top-0 left-0 right-0 h-0.5", colors.dot)} />

                  <div className="p-4 space-y-3">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn("p-1.5 rounded-md bg-background border", colors.ring)}>
                          <Icon className="h-4 w-4 text-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-sm leading-tight truncate">{meta.label}</div>
                          <div className="text-[10.5px] text-muted-foreground leading-tight">{meta.description}</div>
                        </div>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={cn("h-3 w-3 rounded-full shrink-0 mt-1", colors.dot, card.status !== "grey" && "animate-pulse")} />
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                          {colors.label}
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Primary KPI */}
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-2xl font-bold leading-none tabular-nums">{formatPrimary(card)}</div>
                        <div className="text-[10.5px] text-muted-foreground mt-1">{humanizeKey(card.primary_kpi)}</div>
                      </div>
                      {/* Sparkline */}
                      {spark.length > 1 && <Sparkline data={spark.map((s) => s.v)} status={card.status} />}
                    </div>

                    {/* Reasons */}
                    {card.reasons.length > 0 && (
                      <div className="space-y-1">
                        {card.reasons.map((r, i) => (
                          <div key={i} className="flex items-start gap-1.5 text-[11px] leading-snug">
                            <AlertTriangle className={cn("h-3 w-3 shrink-0 mt-0.5", card.status === "red" ? "text-destructive" : "text-warning")} />
                            <span className="text-foreground/80">{r}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {card.reasons.length === 0 && card.status === "green" && (
                      <div className="flex items-center gap-1.5 text-[11px] text-success">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Alle Indikatoren im grünen Bereich</span>
                      </div>
                    )}

                    {/* Drilldown toggle */}
                    <button
                      onClick={() => setExpanded(isOpen ? null : card.domain)}
                      className="w-full flex items-center justify-between text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1"
                    >
                      <span className="flex items-center gap-1">
                        <Activity className="h-3 w-3" />
                        Details {Object.keys(card.secondary ?? {}).length > 0 && `(${Object.keys(card.secondary).length})`}
                      </span>
                      {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>

                    {isOpen && (
                      <div className="pt-2 border-t border-border/60 space-y-1.5">
                        {Object.entries(card.secondary ?? {}).map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between text-[11.5px]">
                            <span className="text-muted-foreground capitalize">{humanizeKey(k)}</span>
                            <span className="font-mono font-medium tabular-nums">
                              {typeof v === "number" ? v.toLocaleString("de-DE") : String(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Action CTA */}
                    {card.cta && card.route && (
                      <Button
                        size="sm"
                        variant={card.status === "red" ? "default" : "outline"}
                        className="w-full gap-1.5 h-8 text-xs"
                        onClick={() => navigate(card.route!)}
                      >
                        <span>{card.cta}</span>
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Footer hint */}
        {live.data && (
          <div className="flex items-center justify-between text-[10.5px] text-muted-foreground px-1">
            <div className="flex items-center gap-1">
              <CircleDot className="h-3 w-3" />
              Live-Status — Auto-Refresh alle 60s
            </div>
            <div>Stand: {new Date(live.data.as_of).toLocaleString("de-DE")}</div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function Sparkline({ data, status }: { data: number[]; status: CockpitStatus }) {
  if (data.length < 2) return null;
  const w = 70;
  const h = 28;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ");
  const stroke =
    status === "red" ? "hsl(var(--destructive))" :
    status === "yellow" ? "hsl(var(--warning))" :
    status === "grey" ? "hsl(var(--muted-foreground))" :
    "hsl(var(--success))";
  return (
    <svg width={w} height={h} className="opacity-80">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
