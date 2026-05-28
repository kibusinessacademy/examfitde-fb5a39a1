/**
 * VerwaltungsOS DailyBrief v1 — Admin Page
 *
 * Read-only Governance-Intelligence-Layer über Oral-Bridge-Realdaten.
 * Route: /admin/verwaltung/daily-brief
 *
 * Drei Sichten:
 *  - Executive (Cluster + Hotspots)
 *  - Governance-Risiken (Eskalations-/Bürgerfrust-Cluster)
 *  - Fachbereichs-Detail (Drill-down)
 *
 * Keine generative Empfehlung — Empfehlungen sind im RPC deterministisch abgeleitet.
 */
import { useEffect, useMemo, useState } from "react";
import {
  listVerwaltungDepartments,
  getVerwaltungDailyBriefDepartment,
  getVerwaltungDailyBriefExecutive,
  getVerwaltungDailyBriefGovernanceRisks,
  getVerwaltungDailyBriefRealityBridge,
  getVerwaltungLiveJobsForQuery,
  type VerwaltungDepartmentSummary,
  type VDailyBriefDepartment,
  type VDailyBriefExecutive,
  type VDailyBriefGovernanceRisks,
  type VRealityBridge,
  type VRealityDepartment,
  type VRealityJobsSummary,
} from "@/lib/berufs-ki/occupational-intelligence";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Flame, ShieldAlert, Activity, MessageSquare, Building2, TrendingDown, Briefcase, Link2, ExternalLink } from "lucide-react";


const WINDOWS = [
  { value: "1", label: "24 Stunden" },
  { value: "7", label: "7 Tage" },
  { value: "30", label: "30 Tage" },
];

function scoreBadge(score: number | null): { variant: "default" | "secondary" | "destructive" | "outline"; label: string } {
  if (score == null) return { variant: "outline", label: "—" };
  if (score >= 85) return { variant: "default", label: `${score}` };
  if (score >= 70) return { variant: "secondary", label: `${score}` };
  return { variant: "destructive", label: `${score}` };
}

function escalationTone(v: number | null | undefined): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 3.5) return "text-destructive";
  if (v >= 2) return "text-warning";
  return "text-success";
}

export default function VerwaltungDailyBriefPage() {
  const [windowDays, setWindowDays] = useState("7");
  const [departments, setDepartments] = useState<VerwaltungDepartmentSummary[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("");
  const [exec, setExec] = useState<VDailyBriefExecutive | null>(null);
  const [risks, setRisks] = useState<VDailyBriefGovernanceRisks | null>(null);
  const [deptBrief, setDeptBrief] = useState<VDailyBriefDepartment | null>(null);
  const [reality, setReality] = useState<VRealityBridge | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDept, setLoadingDept] = useState(false);


  useEffect(() => {
    void listVerwaltungDepartments().then((d) => {
      setDepartments(d);
      if (d.length > 0 && !selectedDept) setSelectedDept(d[0].department_key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    const days = parseInt(windowDays, 10);
    void Promise.all([
      getVerwaltungDailyBriefExecutive(days),
      getVerwaltungDailyBriefGovernanceRisks(days),
    ]).then(([e, r]) => {
      setExec(e);
      setRisks(r);
      setLoading(false);
    });
  }, [windowDays]);

  useEffect(() => {
    if (!selectedDept) return;
    setLoadingDept(true);
    void getVerwaltungDailyBriefDepartment(selectedDept, parseInt(windowDays, 10)).then((b) => {
      setDeptBrief(b);
      setLoadingDept(false);
    });
  }, [selectedDept, windowDays]);

  const sortedClusters = useMemo(
    () =>
      (exec?.clusters ?? []).slice().sort((a, b) => (b.avg_escalation ?? 0) - (a.avg_escalation ?? 0)),
    [exec],
  );

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 space-y-8">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Activity className="h-4 w-4" />
            VerwaltungsOS · Continuous Governance Intelligence
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">DailyBrief</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Lebende Verwaltungsintelligenz aus realen Simulations- und Eskalationsdaten —
            Fachbereiche, Cluster, Kommunikationsmuster, Governance-Risiken.
          </p>
        </div>
        <Select value={windowDays} onValueChange={setWindowDays}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </header>

      {/* Executive Totals */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading ? (
          <>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</>
        ) : (
          <>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Sessions (24h)</div>
              <div className="text-2xl font-semibold mt-1">{exec?.totals.sessions_24h ?? 0}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Sessions (Fenster)</div>
              <div className="text-2xl font-semibold mt-1">{exec?.totals.sessions_7d ?? 0}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Ø Eskalation (0–5)</div>
              <div className={`text-2xl font-semibold mt-1 ${escalationTone(exec?.totals.avg_escalation)}`}>
                {exec?.totals.avg_escalation ?? "—"}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Ø High-Conflict-Anteil</div>
              <div className="text-2xl font-semibold mt-1">
                {exec?.totals.avg_high_conflict_pct != null ? `${exec.totals.avg_high_conflict_pct}%` : "—"}
              </div>
            </Card>
          </>
        )}
      </section>

      {/* Cluster Heat */}
      <section>
        <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
          <Building2 className="h-5 w-5" /> KGSt-Cluster · Eskalations-Heat
        </h2>
        {loading ? <Skeleton className="h-40" /> : (
          <Card className="divide-y">
            {sortedClusters.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">Keine Aktivität im Fenster.</div>
            )}
            {sortedClusters.map((c) => (
              <div key={c.category} className="p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">{c.category}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.departments_active} Fachbereiche · {c.sessions_7d ?? 0} Sessions
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className={escalationTone(c.avg_escalation)}>
                    Ø Eskalation: <strong>{c.avg_escalation ?? "—"}</strong>
                  </span>
                  <Badge variant={(c.high_conflict_pct ?? 0) >= 40 ? "destructive" : "secondary"}>
                    {c.high_conflict_pct ?? 0}% High-Conflict
                  </Badge>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* Governance Risks */}
      <section>
        <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" /> Governance-Risiken
        </h2>
        {loading ? <Skeleton className="h-40" /> : (risks?.risks?.length ?? 0) === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Keine kritischen Risiken im Fenster — alle Fachbereiche innerhalb Toleranz.
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {risks!.risks.map((r) => (
              <Card key={r.department_key} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{r.department_name}</div>
                    <div className="text-xs text-muted-foreground">{r.category}</div>
                  </div>
                  <Badge variant="destructive" className="text-xs">{r.risk_type}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className={escalationTone(r.avg_escalation)}>
                    <Flame className="inline h-3 w-3 mr-1" />
                    Eskal. {r.avg_escalation ?? "—"}
                  </span>
                  <span>{r.high_conflict_pct ?? 0}% High-Conflict</span>
                  <span>{r.sessions_7d} Sessions</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Department Drilldown */}
      <section>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> Fachbereichs-Briefing
          </h2>
          <Select value={selectedDept} onValueChange={setSelectedDept}>
            <SelectTrigger className="w-[280px]"><SelectValue placeholder="Fachbereich wählen" /></SelectTrigger>
            <SelectContent className="max-h-[400px]">
              {departments.map((d) => (
                <SelectItem key={d.department_key} value={d.department_key}>
                  {d.department_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loadingDept || !deptBrief ? <Skeleton className="h-64" /> : (
          <Card className="p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">{deptBrief.department_name}</div>
                <div className="text-xs text-muted-foreground">{deptBrief.category}</div>
              </div>
              <Badge variant="outline">
                <TrendingDown className="h-3 w-3 mr-1" />
                Schwächste Dim.: {deptBrief.weakest_dimension.label} ({deptBrief.weakest_dimension.score})
              </Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {(["buergerverstaendlichkeit","deeskalation","governance_sicherheit","empathie","fachlichkeit"] as const).map((k) => {
                const v = deptBrief.signals.scores[k];
                const b = scoreBadge(v);
                const labels: Record<string,string> = {
                  buergerverstaendlichkeit: "Bürgerverst.",
                  deeskalation: "Deeskalation",
                  governance_sicherheit: "Governance",
                  empathie: "Empathie",
                  fachlichkeit: "Fachlichkeit",
                };
                return (
                  <div key={k} className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{labels[k]}</div>
                    <div className="mt-1"><Badge variant={b.variant}>{b.label}</Badge></div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-muted-foreground">Sessions 24h:</span> <strong>{deptBrief.signals.sessions_24h}</strong></div>
              <div><span className="text-muted-foreground">Sessions Fenster:</span> <strong>{deptBrief.signals.sessions_7d}</strong></div>
              <div className={escalationTone(deptBrief.signals.avg_escalation)}>
                <span className="text-muted-foreground">Ø Eskalation:</span> <strong>{deptBrief.signals.avg_escalation ?? "—"}</strong>
              </div>
              <div><span className="text-muted-foreground">High-Conflict:</span> <strong>{deptBrief.signals.high_conflict_pct ?? 0}%</strong></div>
            </div>

            <div className="rounded-md bg-muted/40 border p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Empfehlung (simulations-basiert)
              </div>
              <div className="text-sm">{deptBrief.recommendation}</div>
            </div>

            {deptBrief.signals.top_emotions && Object.keys(deptBrief.signals.top_emotions).length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Top Persona-Emotionen</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(deptBrief.signals.top_emotions).map(([emo, cnt]) => (
                    <Badge key={emo} variant="secondary">{emo} · {cnt}</Badge>
                  ))}
                </div>
              </div>
            )}

            {deptBrief.kpis?.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Fachbereichs-KPIs (DNA)</div>
                <div className="flex flex-wrap gap-2">
                  {deptBrief.kpis.slice(0, 8).map((k) => (
                    <Badge key={k.key} variant="outline">{k.label}</Badge>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}
      </section>

      <footer className="text-xs text-muted-foreground border-t pt-4">
        Read-only Aggregation aus <code>verwaltung_oral_sessions</code> + <code>verwaltung_oral_turns</code>.
        Keine generativen Empfehlungen — Logik deterministisch im SECURITY-DEFINER-RPC.
      </footer>
    </div>
  );
}
