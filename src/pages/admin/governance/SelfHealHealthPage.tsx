import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Flame, Download, RefreshCw, HeartPulse, ShieldAlert, Activity } from "lucide-react";

type Severity = "critical" | "high" | "medium";
type Health = "green" | "yellow" | "red";

interface ActionItem { code: string; action_type: string; severity: Severity; metric: number; detail: string; }
interface ActionTypeKpi {
  action_type: string; total_24h: number; total_7d: number; success: number; failed: number; skipped: number;
  success_rate: number; followup_checked: number; followup_coverage: number;
  improved: number; no_change: number; regressed: number; effective_rate: number;
  avg_score_delta: number; avg_duration_ms: number; last_run: string | null; health: Health;
}
interface Projection {
  generated_at: string; projector_version: string;
  system: {
    health_score: number; traffic_light: string; auto_heal_allowed: boolean; incident_mode: boolean;
    heals_24h: number; heals_success_24h: number; heals_failed_24h: number; heals_24h_success_rate: number;
    distinct_actions_7d: number; effective_rate_7d: number;
  };
  policy: {
    is_active: boolean; incident_mode: boolean; incident_activated_at: string | null;
    incident_activated_by: string | null; requires_approval: string[]; cooldown_keys: string[];
  };
  action_types: ActionTypeKpi[];
  action_queue: ActionItem[];
  trigger_breakdown: { trigger_source: string; runs_24h: number; success_24h: number; failed_24h: number }[];
}

const SEV_VARIANT: Record<Severity, "destructive" | "default" | "secondary"> = { critical: "destructive", high: "default", medium: "secondary" };
const HEALTH_VARIANT: Record<Health, "default" | "secondary" | "destructive"> = { green: "default", yellow: "secondary", red: "destructive" };
const ACTION_LABEL: Record<string, string> = {
  HEAL_DISABLED: "Auto-Heal blockiert",
  INCIDENT_MODE: "Incident-Mode aktiv",
  HEAL_FAIL_SPIKE: "Heal-Fail-Spike",
  HEAL_SILENCE: "Heal-Stille trotz Last",
  HEAL_THRASHING: "Heal-Thrashing",
  ACTION_REGRESSION: "Heal verschlechtert",
  ACTION_HIGH_FAILURE: "Hohe Heal-Fehlerquote",
  ACTION_NO_EFFECT: "Heal ohne Effekt",
  ACTION_NO_FOLLOWUP: "Follow-up fehlt",
};
const pct = (n: number) => `${Math.round(n * 100)}%`;

function csvDownload(rows: any[], filename: string) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => { if (v == null) return ""; const s = typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export default function SelfHealHealthPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["self-heal-health"],
    queryFn: async (): Promise<Projection> => {
      const { data, error } = await supabase.functions.invoke("evaluate-self-heal-health", { body: {} });
      if (error) throw error;
      if (!data?.projection) throw new Error("Keine Projektion erhalten");
      return data.projection as Projection;
    },
    refetchInterval: 60_000,
  });

  const s = data?.system;
  const redCount = useMemo(() => data?.action_types.filter((k) => k.health === "red").length ?? 0, [data]);

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Self-Healing Cockpit</h1>
            <p className="text-muted-foreground">
              Deterministische Projektion über <code>auto_heal_log</code>, <code>ops_health_summary</code> und aktive Heal-Policy.
              Read-only, kein Eingriff. Auto-Refresh 60 s.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch().then(() => toast.success("Aktualisiert"))} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Lade Self-Heal-Projektion …</div>
      ) : !data ? (
        <Card><CardContent className="pt-6 text-destructive">Konnte Self-Heal-Health nicht laden.</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Health-Score</div><div className={`text-2xl font-bold ${s!.health_score >= 80 ? "text-green-600" : s!.health_score >= 50 ? "text-amber-600" : "text-destructive"}`}>{s!.health_score}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Ampel</div><div className="text-2xl font-bold capitalize">{s!.traffic_light}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Heals 24h</div><div className="text-2xl font-bold">{s!.heals_24h}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Heal-Success 24h</div><div className={`text-2xl font-bold ${s!.heals_24h_success_rate >= 0.8 ? "text-green-600" : "text-destructive"}`}>{pct(s!.heals_24h_success_rate)}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Effective (7d)</div><div className={`text-2xl font-bold ${s!.effective_rate_7d >= 0.5 ? "text-green-600" : s!.effective_rate_7d > 0 ? "text-amber-600" : "text-destructive"}`}>{pct(s!.effective_rate_7d)}</div></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Aktionen 7d</div><div className="text-2xl font-bold">{s!.distinct_actions_7d}</div></CardContent></Card>
          </div>

          {(!s!.auto_heal_allowed || s!.incident_mode) && (
            <Card className="border-destructive/50">
              <CardContent className="pt-6 flex items-center gap-3">
                <ShieldAlert className="h-5 w-5 text-destructive" />
                <div className="text-sm">
                  {!s!.auto_heal_allowed && <div><strong>Auto-Heal blockiert</strong> — System-Bedingungen nicht erfüllt.</div>}
                  {s!.incident_mode && <div><strong>Incident-Mode aktiv</strong>{data.policy.incident_activated_by ? ` von ${data.policy.incident_activated_by}` : ""}{data.policy.incident_activated_at ? ` seit ${new Date(data.policy.incident_activated_at).toLocaleString("de-DE")}` : ""}.</div>}
                </div>
              </CardContent>
            </Card>
          )}

          {data.action_queue.length > 0 && (
            <Card className="border-amber-500/50">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Flame className="h-4 w-4 text-amber-500" /> Action Queue — {data.action_queue.length} priorisierte Hebel
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => csvDownload(data.action_queue, "self-heal-actions.csv")}>
                  <Download className="mr-2 h-4 w-4" /> CSV
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.action_queue.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                      <div className="text-xl font-bold text-muted-foreground w-6">{i + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant={SEV_VARIANT[a.severity]} className="uppercase text-[10px]">{a.severity}</Badge>
                          <span className="font-medium text-sm">{ACTION_LABEL[a.code] ?? a.code}</span>
                          <code className="text-xs text-muted-foreground truncate">{a.action_type}</code>
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">{a.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" /> Trigger-Breakdown (24h)</CardTitle></CardHeader>
              <CardContent>
                {data.trigger_breakdown.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Keine Heals in 24h.</div>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Trigger</TableHead><TableHead className="text-right">Runs</TableHead><TableHead className="text-right">Success</TableHead><TableHead className="text-right">Failed</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.trigger_breakdown.map((t) => (
                        <TableRow key={t.trigger_source}>
                          <TableCell className="font-mono text-xs">{t.trigger_source}</TableCell>
                          <TableCell className="text-right tabular-nums">{t.runs_24h}</TableCell>
                          <TableCell className="text-right tabular-nums text-green-600">{t.success_24h}</TableCell>
                          <TableCell className={`text-right tabular-nums ${t.failed_24h > 0 ? "text-destructive" : "text-muted-foreground"}`}>{t.failed_24h}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><HeartPulse className="h-4 w-4" /> Policy</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Active</span><Badge variant={data.policy.is_active ? "default" : "destructive"}>{data.policy.is_active ? "ja" : "nein"}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Incident-Mode</span><Badge variant={data.policy.incident_mode ? "destructive" : "secondary"}>{data.policy.incident_mode ? "aktiv" : "off"}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Cooldown-Keys</span><span className="font-mono text-xs">{data.policy.cooldown_keys.length}</span></div>
                <div>
                  <div className="text-muted-foreground mb-1">Requires Approval</div>
                  <div className="flex flex-wrap gap-1">
                    {data.policy.requires_approval.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : data.policy.requires_approval.map((r) => <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-base">Heal-Actions ({redCount} rot)</CardTitle>
              <Button variant="outline" size="sm" onClick={() => csvDownload(data.action_types, "self-heal-actions-kpi.csv")}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Action</TableHead><TableHead>Health</TableHead>
                    <TableHead className="text-right">7d</TableHead><TableHead className="text-right">24h</TableHead>
                    <TableHead className="text-right">Success</TableHead><TableHead className="text-right">Effective</TableHead>
                    <TableHead className="text-right">Follow-up</TableHead><TableHead className="text-right">Δ Score</TableHead>
                    <TableHead className="text-right">Improved</TableHead><TableHead className="text-right">Regressed</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.action_types.map((k) => (
                      <TableRow key={k.action_type}>
                        <TableCell className="font-mono text-xs max-w-xs truncate">{k.action_type}</TableCell>
                        <TableCell><Badge variant={HEALTH_VARIANT[k.health]}>{k.health}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{k.total_7d}</TableCell>
                        <TableCell className="text-right tabular-nums">{k.total_24h}</TableCell>
                        <TableCell className={`text-right tabular-nums ${k.success_rate >= 0.8 ? "text-green-600" : k.success_rate >= 0.5 ? "text-amber-600" : "text-destructive"}`}>{pct(k.success_rate)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${k.effective_rate >= 0.5 ? "text-green-600" : k.effective_rate > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{pct(k.effective_rate)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{pct(k.followup_coverage)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${k.avg_score_delta > 0 ? "text-green-600" : k.avg_score_delta < 0 ? "text-destructive" : "text-muted-foreground"}`}>{k.avg_score_delta > 0 ? "+" : ""}{k.avg_score_delta}</TableCell>
                        <TableCell className="text-right tabular-nums text-green-600">{k.improved}</TableCell>
                        <TableCell className={`text-right tabular-nums ${k.regressed > 0 ? "text-destructive" : "text-muted-foreground"}`}>{k.regressed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="text-xs text-muted-foreground text-right">
            Projector {data.projector_version} · generiert {new Date(data.generated_at).toLocaleString("de-DE")}
          </div>
        </>
      )}
    </div>
  );
}
