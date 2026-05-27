import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeft, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { decideOutcomeBundle, exportOutcomeBundle, getOutcomeBundle, type BundleRiskTier, type OutcomeReviewStatus } from "@/lib/berufs-ki/outcome";
import { BundleRiskBadge } from "@/components/berufs-ki/BundleRiskBadge";
import { KpiImpactPanel } from "@/components/berufs-ki/KpiImpactPanel";
import { BundleDecisionTimeline } from "@/components/berufs-ki/BundleDecisionTimeline";

type Bundle = Record<string, unknown> & {
  id: string; outcome_goal: string; vertical_key: string;
  review_status: OutcomeReviewStatus; completeness_pct: number; confidence: number | null;
  agent_team: string[]; created_at: string; review_reason: string | null;
  business_case: unknown; process_model: unknown; kpi_impact: unknown[];
  workflow_graph: unknown; risk_register: unknown[]; sops: unknown[]; roadmap: unknown[];
  rollout_plan: unknown; dashboard_spec: unknown; test_matrix: unknown[]; rollback_plan: unknown;
  agent_outputs: Record<string, unknown>;
};
type Vertical = Record<string, unknown> & { name?: string; industry_key?: string };
type Artifact = { id: string; kind: string; title: string; payload: unknown; created_at: string; export_format: string };

const STATUS_TONE: Record<OutcomeReviewStatus, string> = {
  proposed: "bg-status-bg-subtle text-foreground",
  in_review: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  applied: "bg-primary/10 text-primary",
  rejected: "bg-destructive/10 text-destructive",
  rolled_back: "bg-muted text-muted-foreground",
};

const SECTIONS: Array<{ key: keyof Bundle; label: string; isArray?: boolean }> = [
  { key: "business_case", label: "Business Case" },
  { key: "process_model", label: "Prozess" },
  { key: "kpi_impact", label: "KPI", isArray: true },
  { key: "workflow_graph", label: "Workflow" },
  { key: "risk_register", label: "Risiken", isArray: true },
  { key: "sops", label: "SOPs", isArray: true },
  { key: "roadmap", label: "Roadmap", isArray: true },
  { key: "rollout_plan", label: "Rollout" },
  { key: "dashboard_spec", label: "Dashboard" },
  { key: "test_matrix", label: "Tests", isArray: true },
  { key: "rollback_plan", label: "Rollback" },
];

function isPopulated(v: unknown, isArray = false): boolean {
  if (v == null) return false;
  if (isArray) return Array.isArray(v) && v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return Boolean(v);
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.json`; a.click();
  URL.revokeObjectURL(url);
}

export default function OutcomeBundleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const q = useQuery({
    queryKey: ["outcome-bundle", id],
    queryFn: () => getOutcomeBundle(id as string),
    enabled: !!id,
  });

  const decideMut = useMutation({
    mutationFn: (decision: "approve" | "reject" | "apply" | "rollback" | "in_review") =>
      decideOutcomeBundle(id as string, decision, reason),
    onSuccess: (d) => {
      toast.success(`Status: ${d.status}`);
      setReason("");
      qc.invalidateQueries({ queryKey: ["outcome-bundle", id] });
      qc.invalidateQueries({ queryKey: ["outcome-bundles"] });
      qc.invalidateQueries({ queryKey: ["outcome-cc"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Entscheidung fehlgeschlagen"),
  });

  if (!id) return null;

  if (q.isLoading) {
    return (
      <div className="container mx-auto max-w-7xl space-y-4 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (q.error || !q.data) {
    return (
      <div className="container mx-auto max-w-3xl p-6">
        <Card className="border-destructive/30">
          <CardContent className="flex items-start gap-3 p-6">
            <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <div className="font-medium">Bundle nicht ladbar</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {q.error instanceof Error ? q.error.message : "Unbekannter Fehler"}
              </p>
              <Button variant="outline" className="mt-3" onClick={() => navigate("/admin/berufs-ki/outcome-control")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = q.data as { bundle: Bundle; vertical: Vertical; artifacts: Artifact[] };
  const b = data.bundle;
  const v = data.vertical;
  const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
  const reasonOk = reason.trim().length >= 8;
  const terminal = b.review_status === "applied" || b.review_status === "rolled_back" || b.review_status === "rejected";

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/berufs-ki/outcome-control"><ArrowLeft className="mr-2 h-4 w-4" /> Mission Control</Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => downloadJson(`outcome-bundle-${b.id}`, b)}>
          <Download className="mr-2 h-4 w-4" /> Bundle (JSON)
        </Button>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{v?.name ?? b.vertical_key}</Badge>
          <Badge className={STATUS_TONE[b.review_status]}>{b.review_status}</Badge>
          <span className="text-xs tabular-nums text-muted-foreground">
            {Number(b.completeness_pct).toFixed(0)}% complete · {b.confidence != null ? `conf ${Number(b.confidence).toFixed(2)}` : "conf —"} · {b.agent_team?.length ?? 0} Agenten
          </span>
        </div>
        <h1 className="text-2xl font-semibold leading-snug">{b.outcome_goal}</h1>
        <p className="text-xs text-muted-foreground">
          Bundle {b.id.slice(0, 8)} · erstellt {new Date(b.created_at).toLocaleString()}
        </p>
      </header>

      {/* HITL Decision */}
      {!terminal && (
        <Card>
          <CardHeader><CardTitle className="text-base">HITL — Entscheidung</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="Begründung (≥ 8 Zeichen — landet in Audit-Log)"
              value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            />
            <div className="flex flex-wrap gap-2">
              {b.review_status === "proposed" && (
                <Button size="sm" variant="outline"
                  disabled={!reasonOk || decideMut.isPending}
                  onClick={() => decideMut.mutate("in_review")}>In Review nehmen</Button>
              )}
              <Button size="sm"
                disabled={!reasonOk || decideMut.isPending}
                onClick={() => decideMut.mutate("approve")}>Approve</Button>
              <Button size="sm" variant="destructive"
                disabled={!reasonOk || decideMut.isPending}
                onClick={() => decideMut.mutate("reject")}>Reject</Button>
              {b.review_status === "approved" && (
                <Button size="sm" variant="default"
                  disabled={!reasonOk || decideMut.isPending}
                  onClick={() => decideMut.mutate("apply")}>Apply</Button>
              )}
            </div>
            {b.review_reason && (
              <p className="text-xs text-muted-foreground">Letzte Begründung: {b.review_reason}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="sections" className="w-full">
        <TabsList>
          <TabsTrigger value="sections">Sektionen (11)</TabsTrigger>
          <TabsTrigger value="artifacts">Artifact Library ({artifacts.length})</TabsTrigger>
          <TabsTrigger value="agents">Agent-Outputs ({b.agent_team?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="vertical">Vertical DNA</TabsTrigger>
        </TabsList>

        <TabsContent value="sections" className="mt-4 space-y-3">
          {SECTIONS.map((s) => {
            const val = b[s.key];
            const populated = isPopulated(val, s.isArray);
            return (
              <Card key={String(s.key)} className={populated ? "" : "border-dashed opacity-70"}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-base">{s.label}</CardTitle>
                  <div className="flex items-center gap-2">
                    {populated ? <Badge variant="outline">populated</Badge> : <Badge variant="secondary">leer</Badge>}
                    {populated && (
                      <Button size="sm" variant="ghost" onClick={() => downloadJson(`${s.key as string}-${b.id.slice(0,8)}`, val)}>
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {populated ? (
                    <pre className="max-h-96 overflow-auto rounded bg-muted/40 p-3 text-xs">
                      {JSON.stringify(val, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">Kein Agent hat diese Sektion produziert.</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="artifacts" className="mt-4 space-y-2">
          {artifacts.length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">
              Noch keine exportierten Artifacts. Sie werden beim nächsten Run automatisch erzeugt.
            </CardContent></Card>
          ) : artifacts.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="min-w-0">
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.kind} · {a.export_format} · {new Date(a.created_at).toLocaleString()}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => downloadJson(`${a.kind}-${a.id.slice(0,8)}`, a.payload)}>
                  <Download className="mr-2 h-4 w-4" /> JSON
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="agents" className="mt-4 space-y-2">
          {Object.entries(b.agent_outputs ?? {}).length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">Keine Agent-Outputs gespeichert.</CardContent></Card>
          ) : Object.entries(b.agent_outputs ?? {}).map(([slug, out]) => (
            <Card key={slug}>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{slug}</CardTitle></CardHeader>
              <CardContent>
                <pre className="max-h-72 overflow-auto rounded bg-muted/40 p-3 text-xs">{JSON.stringify(out, null, 2)}</pre>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="vertical" className="mt-4">
          <Card><CardContent className="p-4">
            <pre className="max-h-[600px] overflow-auto rounded bg-muted/40 p-3 text-xs">
              {JSON.stringify(v, null, 2)}
            </pre>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
