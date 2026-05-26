/**
 * Berufs-KI Automation Rules.
 * Verwaltet org-scoped Automationsregeln + One-Click-Evaluation.
 * Route: /berufs-ki/automation
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  useAutomationRules, useUpsertAutomationRule, useEvaluateAutomation,
} from "@/hooks/useBerufsKIActivation";
import { RULE_CATALOG, type AutomationRuleKey } from "@/lib/berufs-ki/automation";

interface OrgOption { id: string; name: string }
function useManagerOrgs() {
  return useQuery({
    queryKey: ["bki", "auto-orgs"],
    queryFn: async (): Promise<OrgOption[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await supabase
        .from("org_memberships")
        .select("org_id, role, organizations(id, name)")
        .eq("user_id", u.user.id).eq("status", "active")
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

export default function BerufsKIAutomationPage() {
  const { data: orgs, isLoading } = useManagerOrgs();
  const [orgId, setOrgId] = useState<string | null>(null);
  useEffect(() => { if (orgs?.length && !orgId) setOrgId(orgs[0].id); }, [orgs, orgId]);

  const rulesQ = useAutomationRules(orgId);
  const upsert = useUpsertAutomationRule(orgId);
  const evaluate = useEvaluateAutomation(orgId);

  const [recoveryThresh, setRecoveryThresh] = useState<number>(15);

  useEffect(() => {
    const r = rulesQ.data?.rules?.find((x) => x.rule_key === "recovery_low_impact");
    const v = r?.params && typeof (r.params as Record<string, unknown>).min_risk_reduction === "number"
      ? Number((r.params as Record<string, unknown>).min_risk_reduction) : 15;
    setRecoveryThresh(v);
  }, [rulesQ.data]);

  if (isLoading) return <div className="container py-10 text-sm text-muted-foreground">Lade Automation…</div>;
  if (!orgs?.length) {
    return (
      <div className="container py-10">
        <Card><CardContent className="p-6 text-sm">
          <div className="mb-2 font-semibold">Automation erfordert Manager-Rolle.</div>
          <Button asChild className="mt-4" size="sm"><Link to="/berufs-ki">Zurück zum Hub</Link></Button>
        </CardContent></Card>
      </div>
    );
  }

  const rules = rulesQ.data?.rules ?? [];
  const findRule = (k: AutomationRuleKey) => rules.find((r) => r.rule_key === k);

  const toggle = async (k: AutomationRuleKey, enabled: boolean, params?: Record<string, unknown>) => {
    const def = RULE_CATALOG.find((c) => c.key === k)?.defaults ?? {};
    try {
      await upsert.mutateAsync({ ruleKey: k, enabled, params: params ?? findRule(k)?.params ?? def });
      toast.success(`${k} ${enabled ? "aktiviert" : "deaktiviert"}.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const run = async () => {
    try {
      const r = await evaluate.mutateAsync(7);
      toast.success(`${r.rules_evaluated} Regel(n), ${r.total_matches} Treffer.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="container space-y-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">Berufs-KI · Automation</div>
          <h1 className="text-2xl font-bold leading-tight">Automationsregeln</h1>
          <p className="text-sm text-muted-foreground">
            Deterministische Auswertung gegen Risk Radar, Cohort-Trends und Recovery-Wirkung.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/berufs-ki/copilot"><ArrowLeft className="mr-1 h-4 w-4" />Copilot</Link>
          </Button>
          <Select value={orgId ?? undefined} onValueChange={setOrgId}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={run} disabled={evaluate.isPending || !orgId}>
            <PlayCircle className="mr-1 h-4 w-4" />
            {evaluate.isPending ? "Werte aus…" : "Jetzt auswerten"}
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" /> Verfügbare Regeln
            <Badge variant="secondary" className="ml-auto text-[10px]">{rules.length} aktiv konfiguriert</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {RULE_CATALOG.map((c) => {
            const r = findRule(c.key);
            const enabled = r?.enabled ?? false;
            return (
              <div key={c.key} className="rounded-md border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{c.label}</span>
                      {enabled
                        ? <Badge variant="outline" className="text-[10px] border-status-success-border text-status-success-text">aktiv</Badge>
                        : <Badge variant="outline" className="text-[10px] text-muted-foreground">aus</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>
                    {c.key === "recovery_low_impact" && enabled && (
                      <div className="mt-2 flex items-center gap-2">
                        <Label htmlFor={`thr-${c.key}`} className="text-[10px] uppercase">Schwelle Risk-Red. %</Label>
                        <Input
                          id={`thr-${c.key}`} type="number" className="h-7 w-24 text-xs"
                          value={recoveryThresh}
                          onChange={(e) => setRecoveryThresh(Number(e.target.value || 0))}
                          onBlur={() => toggle(c.key, true, { min_risk_reduction: recoveryThresh })}
                        />
                      </div>
                    )}
                  </div>
                  <Switch checked={enabled} onCheckedChange={(v) => toggle(c.key, v)} disabled={upsert.isPending} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
