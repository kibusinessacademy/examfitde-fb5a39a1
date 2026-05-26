/**
 * Berufs-KI Manager Copilot.
 * Tagesbriefing + Automation-Quickrun. Reuses manager_* RPCs via manager_copilot_get_brief.
 * Route: /berufs-ki/copilot
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Sparkles, ArrowLeft, AlertOctagon, Zap, ArrowRight, PlayCircle, ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useCopilotBrief, useEvaluateAutomation } from "@/hooks/useBerufsKIActivation";
import { severityClass } from "@/lib/berufs-ki/copilot";

interface OrgOption { id: string; name: string }

function useManagerOrgs() {
  return useQuery({
    queryKey: ["bki", "copilot-orgs"],
    queryFn: async (): Promise<OrgOption[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("org_memberships")
        .select("org_id, role, organizations(id, name)")
        .eq("user_id", u.user.id)
        .eq("status", "active")
        .in("role", ["owner", "admin", "manager"]);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        id: r.organizations?.id ?? r.org_id,
        name: r.organizations?.name ?? "Organisation",
      })).filter((o) => !!o.id);
    },
    staleTime: 60_000,
  });
}

export default function BerufsKICopilotPage() {
  const { data: orgs, isLoading } = useManagerOrgs();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  useEffect(() => { if (orgs?.length && !orgId) setOrgId(orgs[0].id); }, [orgs, orgId]);

  const brief = useCopilotBrief(orgId, days);
  const evaluate = useEvaluateAutomation(orgId);

  if (isLoading) return <div className="container py-10 text-sm text-muted-foreground">Lade Copilot…</div>;
  if (!orgs?.length) {
    return (
      <div className="container py-10">
        <Card><CardContent className="p-6 text-sm">
          <div className="mb-2 font-semibold">Copilot erfordert Manager-Rolle.</div>
          <p className="text-muted-foreground">Owner-, Admin- oder Manager-Rolle in einer Organisation erforderlich.</p>
          <Button asChild className="mt-4" size="sm"><Link to="/berufs-ki">Zurück zum Hub</Link></Button>
        </CardContent></Card>
      </div>
    );
  }

  const data = brief.data;
  const priorities = data && data.reason === "OK" ? data.priorities : [];

  const runEvaluation = async () => {
    try {
      const res = await evaluate.mutateAsync(days);
      if (res.reason === "OK") {
        toast.success(`Automation evaluiert: ${res.rules_evaluated} Regel(n), ${res.total_matches} Treffer.`);
      } else {
        toast.error("Auswertung nicht autorisiert.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="container space-y-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">
            Berufs-KI · Manager Copilot
          </div>
          <h1 className="text-2xl font-bold leading-tight">Heutiges Briefing</h1>
          <p className="text-sm text-muted-foreground">
            Deterministische Prioritäten aus Risiko-Radar, Cohorts, Interventionen und Graph-Risiken.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/berufs-ki"><ArrowLeft className="mr-1 h-4 w-4" />Hub</Link>
          </Button>
          <Select value={orgId ?? undefined} onValueChange={setOrgId}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Organisation" /></SelectTrigger>
            <SelectContent>
              {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 Tage</SelectItem>
              <SelectItem value="7">7 Tage</SelectItem>
              <SelectItem value="14">14 Tage</SelectItem>
              <SelectItem value="30">30 Tage</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={runEvaluation} disabled={evaluate.isPending || !orgId}>
            <PlayCircle className="mr-1 h-4 w-4" />
            {evaluate.isPending ? "Werte aus…" : "Automation auswerten"}
          </Button>
        </div>
      </header>

      <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Snapshot
            {data?.snapshot && (
              <Badge variant="outline" className="ml-auto text-[10px]">
                {data.snapshot.total_learners} Lerner · Ø Risk-Red. {Math.round(data.snapshot.avg_risk_reduction)}%
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-xs sm:grid-cols-2">
          {data?.snapshot.best_intervention && (
            <div className="rounded-md border bg-card p-3">
              <div className="text-[10px] uppercase font-semibold tracking-wide text-status-success-text">
                Stärkste Maßnahme
              </div>
              <div className="mt-1 font-semibold">{data.snapshot.best_intervention.action_key}</div>
              <div className="text-muted-foreground">Ø {data.snapshot.best_intervention.avg_outcome_score}</div>
            </div>
          )}
          {data?.snapshot.weakest_intervention && (
            <div className="rounded-md border bg-card p-3">
              <div className="text-[10px] uppercase font-semibold tracking-wide text-status-warning-text">
                Schwächste Maßnahme
              </div>
              <div className="mt-1 font-semibold">{data.snapshot.weakest_intervention.action_key}</div>
              <div className="text-muted-foreground">Ø {data.snapshot.weakest_intervention.avg_outcome_score}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertOctagon className="h-4 w-4 text-primary" />
            Prioritäten ({priorities.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {brief.isLoading && <div className="h-24 animate-pulse rounded-md bg-muted/30" />}
          {!brief.isLoading && priorities.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Keine kritischen Punkte im Zeitfenster — alles im grünen Bereich.
            </p>
          )}
          <ul className="space-y-2">
            {priorities.map((p, i) => (
              <li key={i} className="flex items-start gap-3 rounded-md border bg-card p-3">
                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold ${severityClass(p.severity)}`}>
                  {p.severity === "high" ? "!" : p.severity === "medium" ? "•" : "✓"}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-semibold">{p.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{p.action}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                    {p.count !== undefined && <span>Count: <b>{p.count}</b>{p.total ? ` / ${p.total}` : ""}</span>}
                    {p.learners_affected !== undefined && <span>Lerner: <b>{p.learners_affected}</b></span>}
                    {p.avg_mastery !== undefined && <span>Ø Mastery: <b>{Math.round(p.avg_mastery * 100)}%</b></span>}
                    {p.delta !== undefined && <span>Δ <b>{p.delta}</b></span>}
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={p.route}>Öffnen <ArrowRight className="ml-1 h-3 w-3" /></Link>
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-primary" /> Aktionen
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/berufs-ki/automation"><ShieldCheck className="mr-1 h-3 w-3" />Automationen verwalten</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/berufs-ki/intelligence">Team-Cockpit</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/berufs-ki/intelligence/executive">Executive Cockpit</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/berufs-ki/graph-activation">Graph-Aktivierung</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/berufs-ki/suites">Produkt-Suiten</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
