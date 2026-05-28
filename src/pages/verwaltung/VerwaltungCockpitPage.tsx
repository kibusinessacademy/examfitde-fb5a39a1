/**
 * VerwaltungsOS Executive Cockpit v1 — Premium Mission Control
 *
 * Route: /admin/verwaltung/cockpit
 *
 * Eine Server-Aggregation (verwaltung_executive_cockpit) +
 * parallele Live-Calls für NINA-Lagebild und Arbeitsmarkt-Trend
 * der Top-Reality-Departments. Read-only. Source-attribuiert.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  getVerwaltungExecutiveCockpit,
  getVerwaltungLiveJobsForQuery,
  type VExecutiveCockpit,
  type VRealityDepartment,
  type VRealityJobsSummary,
  type VWorkflowPressureDept,
} from "@/lib/berufs-ki/occupational-intelligence";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Activity, AlertTriangle, ArrowRight, Briefcase, Building2,
  Flame, Gauge, Radio, ShieldAlert, Siren, TrendingUp, Workflow,
} from "lucide-react";

type ExecutivePersona = "buergermeister" | "amtsleiter" | "governance";
const PERSONAS: { value: ExecutivePersona; label: string; hint: string }[] = [
  { value: "buergermeister", label: "Bürgermeister", hint: "Lagebild · Bürgerfront · Eskalationen" },
  { value: "amtsleiter", label: "Amtsleiter", hint: "Workflow-Druck · Reality · Hotspots" },
  { value: "governance", label: "Governance", hint: "Risiken · KPI-Drift · Cluster" },
];
const PERSONA_KEY = "verwaltungsos.cockpit.persona";

function pressureTone(c: VWorkflowPressureDept["classification"]): string {
  if (c === "WORKFLOW_PRESSURE") return "bg-status-bg-danger-subtle text-status-fg-danger border-status-border-danger";
  if (c === "AUTOMATION_OPPORTUNITY") return "bg-status-bg-warning-subtle text-status-fg-warning border-status-border-warning";
  if (c === "GOVERNANCE_GAP") return "bg-status-bg-info-subtle text-status-fg-info border-status-border-info";
  return "bg-muted text-muted-foreground border-border";
}

const WINDOWS = [
  { value: "1", label: "24 Stunden" },
  { value: "7", label: "7 Tage" },
  { value: "30", label: "30 Tage" },
];

type NinaWarning = { id: string; headline: string; severity: string; sender?: string; sent?: string };
interface BundLagebild {
  nina?: { items?: NinaWarning[]; count?: number };
  pegel?: { active_alerts?: number };
  fetched_at?: string;
  source?: string;
}

function priorityTone(p: VRealityDepartment["reality_priority"]): string {
  if (p === "HIGH") return "bg-status-bg-danger-subtle text-status-fg-danger border-status-border-danger";
  if (p === "MEDIUM") return "bg-status-bg-warning-subtle text-status-fg-warning border-status-border-warning";
  if (p === "LOW") return "bg-status-bg-info-subtle text-status-fg-info border-status-border-info";
  return "bg-muted text-muted-foreground border-border";
}

function escalationTone(v: number | null | undefined): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 3.5) return "text-destructive";
  if (v >= 2) return "text-warning";
  return "text-success";
}

export default function VerwaltungCockpitPage() {
  const [windowDays, setWindowDays] = useState("7");
  const [persona, setPersona] = useState<ExecutivePersona>(() => {
    if (typeof window === "undefined") return "amtsleiter";
    const v = window.localStorage.getItem(PERSONA_KEY);
    return (v === "buergermeister" || v === "amtsleiter" || v === "governance") ? (v as ExecutivePersona) : "amtsleiter";
  });
  const [cockpit, setCockpit] = useState<VExecutiveCockpit | null>(null);
  const [loading, setLoading] = useState(true);
  const [lagebild, setLagebild] = useState<BundLagebild | null>(null);
  const [jobsByDept, setJobsByDept] = useState<Record<string, VRealityJobsSummary | null>>({});

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(PERSONA_KEY, persona);
  }, [persona]);


  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const days = parseInt(windowDays, 10);
    Promise.all([
      getVerwaltungExecutiveCockpit(days),
      supabase.functions.invoke("verwaltung-bund-lagebild", { body: {} })
        .then(({ data }) => (data as BundLagebild) ?? null)
        .catch(() => null),
    ]).then(([c, l]) => {
      if (cancelled) return;
      setCockpit(c);
      setLagebild(l);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [windowDays]);

  // Parallel live-Arbeitsmarkt-Trends für Top-Reality-Departments
  useEffect(() => {
    const depts = (cockpit?.reality?.departments ?? []).slice(0, 4);
    depts.forEach((d) => {
      if (!d.market_query || jobsByDept[d.department_key] !== undefined) return;
      getVerwaltungLiveJobsForQuery(d.market_query).then((j) => {
        setJobsByDept((prev) => ({ ...prev, [d.department_key]: j }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cockpit]);

  const totals = cockpit?.executive?.totals;
  const clusters = cockpit?.executive?.clusters ?? [];
  const hotspots = cockpit?.executive?.hotspots ?? [];
  const risks = cockpit?.risks?.risks ?? [];
  const reality = cockpit?.reality?.departments ?? [];
  const ninaItems = lagebild?.nina?.items ?? [];
  const pressure = cockpit?.workflow_pressure ?? null;
  const pressureTop = pressure?.top_pressure ?? [];
  const pressureMix = pressure?.classification_mix ?? {};

  const highReality = useMemo(
    () => reality.filter((d) => d.reality_priority === "HIGH" || d.reality_priority === "MEDIUM").slice(0, 4),
    [reality],
  );

  const personaHint = PERSONAS.find((p) => p.value === persona)?.hint ?? "";

  return (
    <div className="min-h-screen bg-background">
      {/* Premium Hero */}
      <div className="border-b border-border bg-gradient-to-br from-surface-2 to-surface-1">
        <div className="container py-8 space-y-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" />
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  VerwaltungsOS · Executive Cockpit
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
                Continuous Governance Intelligence
              </h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Live-Korrelation von Fachbereichs-DNA, Oral-Eskalation, Arbeitsmarkt-Realität
                und Bund-Lagebild. Read-only, source-attribuiert.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={persona} onValueChange={(v) => setPersona(v as ExecutivePersona)}>
                <SelectTrigger className="w-[180px]" aria-label="Executive Persona">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERSONAS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={windowDays} onValueChange={setWindowDays}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/verwaltung/agents">AgentOS · Workflows <ArrowRight className="ml-1 h-3 w-3" /></Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/verwaltung/daily-brief">DailyBrief · Drilldown <ArrowRight className="ml-1 h-3 w-3" /></Link>
              </Button>
            </div>
          </div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Fokus · {personaHint}</div>

          {/* KPI-Strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile icon={<Activity className="h-4 w-4" />} label="Sessions (24h)" value={totals?.sessions_24h ?? "—"} loading={loading} />
            <KpiTile icon={<Activity className="h-4 w-4" />} label="Sessions (7d)" value={totals?.sessions_7d ?? "—"} loading={loading} />
            <KpiTile
              icon={<Flame className="h-4 w-4" />}
              label="Ø Eskalation"
              value={totals?.avg_escalation != null ? totals.avg_escalation.toFixed(2) : "—"}
              valueClassName={escalationTone(totals?.avg_escalation ?? null)}
              loading={loading}
            />
            <KpiTile
              icon={<ShieldAlert className="h-4 w-4" />}
              label="Hochkonflikt-Anteil"
              value={totals?.avg_high_conflict_pct != null ? `${Math.round(totals.avg_high_conflict_pct)}%` : "—"}
              loading={loading}
            />
          </div>
        </div>
      </div>

      <div className="container py-8 space-y-8">
        {/* Reality + Lagebild Split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-5 space-y-4 shadow-elev-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold uppercase tracking-wide">Reality-Priorität · DNA × Oral × Arbeitsmarkt</h2>
              </div>
              <Badge variant="outline" className="text-[10px]">live</Badge>
            </div>
            {loading ? <Skeleton className="h-48 w-full" /> : highReality.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine HIGH/MEDIUM-Departments im Zeitfenster.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {highReality.map((d) => {
                  const jobs = jobsByDept[d.department_key];
                  return (
                    <div key={d.department_key} className={`rounded-lg border p-3 space-y-2 ${priorityTone(d.reality_priority)}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-sm">{d.department_name}</div>
                          <div className="text-[11px] opacity-70">{d.category}</div>
                        </div>
                        <Badge variant="outline" className="text-[10px] bg-background/60">{d.reality_priority}</Badge>
                      </div>
                      <div className="flex gap-3 text-[11px] flex-wrap">
                        <span><strong>{d.oral_sessions}</strong> Sessions</span>
                        <span>Ø Esk. <strong>{d.avg_escalation.toFixed(2)}</strong></span>
                        <span>{Math.round(d.high_conflict_pct)}% Konflikt</span>
                      </div>
                      {jobs ? (
                        <div className="flex items-center gap-2 text-[11px] pt-2 border-t border-current/20">
                          <Briefcase className="h-3 w-3" />
                          <span><strong>{jobs.total.toLocaleString("de-DE")}</strong> offene Stellen</span>
                          <span className="opacity-60">· {jobs.trend_7d} (7d)</span>
                        </div>
                      ) : jobs === null ? null : (
                        <Skeleton className="h-4 w-32" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="pt-2 border-t border-border">
              <p className="text-[11px] text-muted-foreground">
                Quelle: oral_sessions × department_dna × BA Jobsuche (bund.dev). Pass-through, keine Persistenz.
              </p>
            </div>
          </Card>

          <Card className="p-5 space-y-4 shadow-elev-1">
            <div className="flex items-center gap-2">
              <Siren className="h-4 w-4 text-warning" />
              <h2 className="text-sm font-semibold uppercase tracking-wide">Bund-Lagebild · NINA</h2>
            </div>
            {loading ? <Skeleton className="h-32 w-full" /> : ninaItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aktuell keine NINA-Warnungen.</p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-auto">
                {ninaItems.slice(0, 6).map((w) => (
                  <li key={w.id} className="text-xs border-l-2 border-warning pl-2">
                    <div className="font-medium line-clamp-2">{w.headline}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {w.severity} · {w.sender ?? "—"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-muted-foreground border-t border-border pt-2">
              Quelle: NINA (BBK) · {lagebild?.fetched_at ? new Date(lagebild.fetched_at).toLocaleTimeString("de-DE") : "—"}
            </p>
          </Card>
        </div>

        {/* Workflow-Pressure (AgentOS Signal Bridge) */}
        <Card className="p-5 space-y-4 shadow-elev-1">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Workflow className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wide">
                Workflow-Druck · AgentOS-Signale × Eskalation
              </h2>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Gauge className="h-3 w-3" /> Ø Pressure&nbsp;
                <strong className="text-foreground tabular-nums">{pressure?.pressure_avg ?? "—"}</strong>
              </span>
              <span>{pressure?.department_count ?? 0} Fachbereiche</span>
            </div>
          </div>
          {loading ? <Skeleton className="h-32 w-full" /> : !pressure ? (
            <p className="text-sm text-muted-foreground">Keine Workflow-Signale im Zeitfenster.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {Object.entries(pressureMix).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="text-[10px] font-mono">
                    {k} · {String(v)}
                  </Badge>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pressureTop.slice(0, 6).map((d) => (
                  <div key={d.department_key} className={`rounded-lg border p-3 space-y-2 ${pressureTone(d.classification)}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{d.display_name ?? d.department_key}</div>
                        <div className="text-[11px] opacity-70">{d.workflow_count} Workflows · Esk Ø {d.avg_escalation?.toFixed?.(2) ?? "—"}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold tabular-nums leading-none">{d.pressure_score}</div>
                        <Badge variant="outline" className="text-[9px] mt-1 bg-background/60">{d.classification}</Badge>
                      </div>
                    </div>
                    {Array.isArray(d.top_workflows) && d.top_workflows.length > 0 && (
                      <ul className="text-[11px] space-y-0.5 pt-1 border-t border-current/20">
                        {d.top_workflows.slice(0, 3).map((wf) => (
                          <li key={wf.workflow_key} className="flex items-center justify-between gap-2">
                            <span className="truncate">{wf.workflow_name}</span>
                            <span className="opacity-70 shrink-0">
                              esc {wf.escalation_count} · auto {wf.automation_count} · kpi {wf.kpi_count}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                Quelle: verwaltung_agent_workflows × verwaltung_oral_sessions · deterministisch in SQL, kein LLM.
              </p>
            </>
          )}
        </Card>

        {/* Cluster-Heat + Risk-Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-5 space-y-4 shadow-elev-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wide">KGSt-Cluster Heat</h2>
            </div>
            {loading ? <Skeleton className="h-40 w-full" /> : (
              <div className="space-y-2">
                {clusters.map((c) => (
                  <div key={c.category} className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{c.category}</div>
                      <div className="text-[11px] text-muted-foreground">{c.departments_active} Fachbereiche aktiv</div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span>{c.sessions_7d ?? 0} Sessions</span>
                      <span className={escalationTone(c.avg_escalation)}>
                        Esk {c.avg_escalation?.toFixed(2) ?? "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-4 shadow-elev-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h2 className="text-sm font-semibold uppercase tracking-wide">Governance-Risiken</h2>
            </div>
            {loading ? <Skeleton className="h-40 w-full" /> : risks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine klassifizierten Risiken im Zeitfenster.</p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-auto">
                {risks.slice(0, 8).map((r, i) => (
                  <li key={`${r.department_key}-${i}`} className="border border-status-border-danger bg-status-bg-danger-subtle rounded p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{r.department_name}</span>
                      <Badge variant="destructive" className="text-[9px]">{r.risk_type}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {r.sessions_7d} Sessions · Esk {r.avg_escalation?.toFixed(2) ?? "—"} · {Math.round(r.high_conflict_pct ?? 0)}% Konflikt
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Hotspots Tabelle */}
        <Card className="p-5 space-y-4 shadow-elev-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-destructive" />
              <h2 className="text-sm font-semibold uppercase tracking-wide">Eskalations-Hotspots (Top 8)</h2>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/verwaltung/daily-brief">Fachbereichs-Drilldown <ArrowRight className="ml-1 h-3 w-3" /></Link>
            </Button>
          </div>
          {loading ? <Skeleton className="h-40 w-full" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 font-medium">Fachbereich</th>
                    <th className="text-left py-2 font-medium">Cluster</th>
                    <th className="text-right py-2 font-medium">Sessions 7d</th>
                    <th className="text-right py-2 font-medium">Ø Eskalation</th>
                    <th className="text-right py-2 font-medium">Konflikt</th>
                    <th className="text-right py-2 font-medium">Schwächste Dim.</th>
                  </tr>
                </thead>
                <tbody>
                  {hotspots.slice(0, 8).map((h) => (
                    <tr key={h.department_key} className="border-b border-border last:border-0">
                      <td className="py-2 font-medium">{h.department_name}</td>
                      <td className="py-2 text-muted-foreground">{h.category}</td>
                      <td className="py-2 text-right">{h.sessions_7d}</td>
                      <td className={`py-2 text-right ${escalationTone(h.avg_escalation)}`}>
                        {h.avg_escalation?.toFixed(2) ?? "—"}
                      </td>
                      <td className="py-2 text-right">{Math.round(h.high_conflict_pct ?? 0)}%</td>
                      <td className="py-2 text-right">{h.weakest_score ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <p className="text-[11px] text-muted-foreground text-center">
          VerwaltungsOS Executive Cockpit v1 · Server-aggregierter Read-Only-Layer · Generiert {cockpit?.generated_at ? new Date(cockpit.generated_at).toLocaleString("de-DE") : "—"}
        </p>
      </div>
    </div>
  );
}

function KpiTile({
  icon, label, value, valueClassName = "", loading,
}: { icon: React.ReactNode; label: string; value: React.ReactNode; valueClassName?: string; loading?: boolean }) {
  return (
    <Card className="p-4 space-y-2 shadow-elev-1">
      <div className="flex items-center gap-2 text-muted-foreground text-[11px] uppercase tracking-wide">
        {icon}<span>{label}</span>
      </div>
      {loading ? <Skeleton className="h-7 w-20" /> : (
        <div className={`text-2xl font-semibold tabular-nums ${valueClassName}`}>{value}</div>
      )}
    </Card>
  );
}
