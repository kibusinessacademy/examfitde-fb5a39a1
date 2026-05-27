import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { fetchOutcomeControlCenter, listOutcomeBundles, runOutcomeAgentTeam, type OutcomeReviewStatus } from "@/lib/berufs-ki/outcome";

const VERTICALS = [
  ["public_admin","Öffentliche Verwaltung"],["hr","HR"],["real_estate","Immobilien"],
  ["healthcare","Healthcare"],["banking","Banking"],["crafts","Handwerk"],
  ["education","Bildung"],["funding","Fördermittel"],["consulting","Consulting"],["support","Support"],
] as const;

const STATUS_TONE: Record<OutcomeReviewStatus, string> = {
  proposed: "bg-status-bg-subtle text-foreground",
  in_review: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  applied: "bg-primary/10 text-primary",
  rejected: "bg-destructive/10 text-destructive",
  rolled_back: "bg-muted text-muted-foreground",
};

export default function OutcomeControlCenterPage() {
  const qc = useQueryClient();
  const [goal, setGoal] = useState("");
  const [vertical, setVertical] = useState<string>("public_admin");

  const cc = useQuery({ queryKey: ["outcome-cc"], queryFn: fetchOutcomeControlCenter });
  const bundles = useQuery({ queryKey: ["outcome-bundles"], queryFn: () => listOutcomeBundles() });

  const runMut = useMutation({
    mutationFn: () => runOutcomeAgentTeam({ outcome_goal: goal, vertical_key: vertical }),
    onSuccess: (d) => {
      toast.success(`Outcome Bundle erzeugt — ${d.completeness_pct?.toFixed(0)}% complete`);
      setGoal("");
      qc.invalidateQueries({ queryKey: ["outcome-cc"] });
      qc.invalidateQueries({ queryKey: ["outcome-bundles"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Run fehlgeschlagen"),
  });

  const b = cc.data?.bundles;
  const ccErr = cc.error instanceof Error ? cc.error.message : null;
  const bundlesErr = bundles.error instanceof Error ? bundles.error.message : null;

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <header className="space-y-2">
        <Badge variant="outline" className="uppercase tracking-wide">BerufAgentOS · Mission Control</Badge>
        <h1 className="text-3xl font-semibold">Outcome Control Center</h1>
        <p className="text-muted-foreground max-w-3xl">
          Berufs- und Branchenwissen in messbare Projektergebnisse. Jeder Run erzeugt ein reviewbares Outcome-Bundle
          (Business Case · Prozess · KPI · Workflow · Risiko · SOPs · Roadmap · Rollout · Dashboard · Tests · Rollback).
        </p>
      </header>

      {/* KPI Strip */}
      {ccErr && (
        <Card className="border-destructive/30">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
            <div className="text-sm"><span className="font-medium">Control-Center nicht ladbar:</span> {ccErr}</div>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cc.isLoading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)
          : [
              ["Bundles gesamt", b?.total ?? 0],
              ["In Review", (b?.proposed ?? 0) + (b?.in_review ?? 0)],
              ["Approved", b?.approved ?? 0],
              ["Applied", b?.applied ?? 0],
              ["Ø Completeness", b?.avg_completeness ? `${Number(b.avg_completeness).toFixed(0)}%` : "—"],
            ].map(([label, val]) => (
              <Card key={label as string} className="shadow-elev-1">
                <CardContent className="p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{val as string | number}</div>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* New Outcome Run */}
      <Card>
        <CardHeader>
          <CardTitle>Neuer Outcome-Run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_240px]">
            <Textarea
              placeholder="Outcome-Ziel — z. B. „Antragsbearbeitung im Sozialamt um 40% beschleunigen"
              value={goal} onChange={(e) => setGoal(e.target.value)} rows={3}
            />
            <Select value={vertical} onValueChange={setVertical}>
              <SelectTrigger><SelectValue placeholder="Branche" /></SelectTrigger>
              <SelectContent>
                {VERTICALS.map(([k, n]) => <SelectItem key={k} value={k}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Sequentielles Team: Strategy · Product · Workflow · Build · UX · SEO · Growth · Security · Compliance · Executive.
              Jeder Output ist HITL-reviewbar.
            </p>
            <Button onClick={() => runMut.mutate()} disabled={runMut.isPending || goal.trim().length < 8}>
              {runMut.isPending ? "Team läuft…" : "Outcome-Team starten"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Agent Team Board */}
      <Card>
        <CardHeader><CardTitle>Agent Team Board</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {(cc.data?.agent_team ?? []).map((a) => (
              <div key={a.slug} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                <div>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">{a.slug} · {a.category}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="tabular-nums">{a.runs_24h} Runs/24h</div>
                  {a.requires_approval && <Badge variant="outline" className="mt-1">HITL</Badge>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Bundles List */}
      <Card>
        <CardHeader><CardTitle>Outcome Bundles</CardTitle></CardHeader>
        <CardContent>
          {bundles.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : bundlesErr ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 p-3 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
              <span>Bundles nicht ladbar: {bundlesErr}</span>
            </div>
          ) : (bundles.data ?? []).length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Noch keine Bundles. Starte oben einen Outcome-Run — das Team produziert Business-Case, KPI-Impact,
              Workflow-Graph, Risiko-Register und Roadmap.
            </div>
          ) : (
            <div className="space-y-2">
              {(bundles.data ?? []).map((row) => (
                <Link
                  key={row.id}
                  to={`/admin/berufs-ki/outcome-bundles/${row.id}`}
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-3 transition hover:border-primary/50 hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{row.outcome_goal}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.vertical_key} · {row.agent_team?.length ?? 0} Agenten · {new Date(row.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{Number(row.completeness_pct).toFixed(0)}%</span>
                    <Badge className={STATUS_TONE[row.review_status]}>{row.review_status}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
