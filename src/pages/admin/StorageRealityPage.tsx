import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ShieldCheck, Loader2, RefreshCcw, Lock, Swords, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";

type Bucket = {
  bucket_id: string;
  purpose: string | null;
  tenant_model: string;
  content_class: string;
  expected_path_regex: string | null;
  owner_module: string | null;
  risk_level: string;
  is_public: boolean | null;
  observed_object_count: number | null;
  open_findings: number;
  high_open_findings: number;
  maturity: "bronze" | "silver" | "gold" | "platinum";
  last_seen_at: string | null;
};

type Kpis = {
  total_buckets: number;
  public_buckets: number;
  private_buckets: number;
  unclassified_buckets: number;
  uncl_content_buckets: number;
  open_findings: number;
  hi_open_findings: number;
  no_tenant_prefix_findings: number;
  flat_root_findings: number;
  public_bucket_findings: number;
  mixed_path_findings: number;
  findings_by_content_class: Record<string, number>;
};

type Finding = {
  id: string;
  bucket_id: string;
  finding_type: string;
  severity: string;
  content_class: string;
  path_sample: string | null;
  evidence: any;
  recommendation: string | null;
  status: string;
  created_at: string;
};

type Run = {
  id: string;
  status: string;
  buckets_scanned: number | null;
  objects_sampled: number | null;
  findings_count: number | null;
  started_at: string;
  finished_at: string | null;
  source: string;
};

const sevColor: Record<string, string> = {
  critical: "destructive",
  high: "destructive",
  medium: "default",
  low: "secondary",
  info: "outline",
};
const matColor: Record<string, string> = {
  bronze: "destructive",
  silver: "secondary",
  gold: "default",
  platinum: "default",
};

type AttackKpis = {
  total_attack_runs: number;
  total_attack_results: number;
  total_leaks: number;
  critical_leaks: number;
  buckets_with_leaks: number;
  last_attack_run_at: string | null;
};

type AttackResultRow = {
  id: string;
  run_id: string;
  bucket_id: string;
  attack_type: string;
  result: string;
  severity: string;
  content_class: string;
  synthetic_tenant: string | null;
  target_path: string | null;
  evidence: any;
  created_at: string;
};

type AttackPolicy = {
  id: string;
  enabled: boolean;
  synthetic_prefix: string;
  allowed_buckets: string[];
  excluded_buckets: string[];
  max_objects_per_bucket: number;
  notes: string | null;
};

export default function StorageRealityPage() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [attackKpis, setAttackKpis] = useState<AttackKpis | null>(null);
  const [attackResults, setAttackResults] = useState<AttackResultRow[]>([]);
  const [policy, setPolicy] = useState<AttackPolicy | null>(null);
  const [running, setRunning] = useState(false);
  const [attacking, setAttacking] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [bRes, fRes, rRes, kRes, akRes, arRes, pRes] = await Promise.all([
      (supabase as any).from("v_admin_storage_bucket_maturity").select("*"),
      (supabase as any)
        .from("storage_rls_audit_findings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      (supabase as any)
        .from("storage_audit_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(20),
      (supabase as any).from("v_admin_storage_audit_kpis").select("*").maybeSingle(),
      (supabase as any).from("v_admin_storage_attack_kpis").select("*").maybeSingle(),
      (supabase as any)
        .from("storage_attack_run_results")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      (supabase as any).from("storage_attack_policies").select("*").limit(1).maybeSingle(),
    ]);
    if (!bRes.error) setBuckets(bRes.data ?? []);
    if (!fRes.error) setFindings(fRes.data ?? []);
    if (!rRes.error) setRuns(rRes.data ?? []);
    if (!kRes.error) setKpis(kRes.data ?? null);
    if (!akRes.error) setAttackKpis(akRes.data ?? null);
    if (!arRes.error) setAttackResults(arRes.data ?? []);
    if (!pRes.error) setPolicy(pRes.data ?? null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function runAudit() {
    setRunning(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("storage-reality-audit", {
        body: { sample_size: 50 },
      });
      if (error) throw error;
      toast.success(
        `Audit fertig — ${data.buckets_scanned} Buckets, ${data.objects_sampled} Objekte, ${data.findings} Findings`,
      );
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Audit fehlgeschlagen");
    } finally {
      setRunning(false);
    }
  }

  async function runAttack() {
    if (!policy?.enabled) {
      toast.error("Kill-Switch ist aus. Erst Attack-Simulation aktivieren.");
      return;
    }
    if (!confirm("Synthetische Attack-Simulation starten? Schreibt nur unter __storage_audit__/<run_id>/ und räumt am Ende auf.")) return;
    setAttacking(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("storage-attack-simulator", { body: {} });
      if (error) throw error;
      toast.success(`Attack fertig — ${data.attacks_run} Angriffe, ${data.leaks} Leaks, ${data.cleaned} Objekte aufgeräumt`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Attack-Simulation fehlgeschlagen");
    } finally {
      setAttacking(false);
    }
  }

  async function toggleKillSwitch(next: boolean) {
    if (!policy) return;
    const { error } = await (supabase as any)
      .from("storage_attack_policies")
      .update({ enabled: next, updated_at: new Date().toISOString() })
      .eq("id", policy.id);
    if (error) { toast.error(error.message); return; }
    setPolicy({ ...policy, enabled: next });
    toast.success(next ? "Attack-Simulation aktiviert" : "Attack-Simulation deaktiviert");
  }

  const score = (() => {
    if (buckets.length === 0) return 0;
    const weight = { bronze: 0, silver: 50, gold: 80, platinum: 100 } as Record<string, number>;
    return Math.round(buckets.reduce((s, b) => s + (weight[b.maturity] ?? 0), 0) / buckets.length);
  })();

  return (
    <div className="container py-6 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Storage Reality Audit</h1>
            <p className="text-sm text-muted-foreground">
              Phase 0 — read-only Inventar & Diagnose. Keine Bucket-/Object-/Policy-Änderungen.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Lock className="h-3 w-3" /> read-only
          </Badge>
          <Button onClick={runAudit} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            <span className="ml-2">Audit starten</span>
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Buckets gesamt" value={kpis?.total_buckets ?? buckets.length} />
        <Stat label="Public / Private" value={`${kpis?.public_buckets ?? 0} / ${kpis?.private_buckets ?? 0}`} accent={(kpis?.public_buckets ?? 0) > 0} />
        <Stat label="Open Findings" value={kpis?.open_findings ?? 0} />
        <Stat label="High / Critical" value={kpis?.hi_open_findings ?? 0} accent={(kpis?.hi_open_findings ?? 0) > 0} />
        <Stat label="Ohne Tenant-Prefix" value={kpis?.no_tenant_prefix_findings ?? 0} accent={(kpis?.no_tenant_prefix_findings ?? 0) > 0} />
        <Stat label="Flat-Root Objekte" value={kpis?.flat_root_findings ?? 0} />
        <Stat label="Mixed Pfade" value={kpis?.mixed_path_findings ?? 0} />
        <Stat label="Maturity-Score" value={`${score}/100`} />
      </section>

      {kpis?.findings_by_content_class && Object.keys(kpis.findings_by_content_class).length > 0 && (
        <section>
          <div className="text-xs text-muted-foreground mb-2">Open Findings nach Content-Klasse</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(kpis.findings_by_content_class).map(([cls, n]) => (
              <Badge key={cls} variant={["learner_data","certificate","assessment","exam_content"].includes(cls) ? "destructive" : "secondary"}>
                {cls}: {n}
              </Badge>
            ))}
          </div>
        </section>
      )}

      <Tabs defaultValue="buckets">
        <TabsList>
          <TabsTrigger value="buckets">Buckets</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>


        <TabsContent value="buckets">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="p-2">Bucket</th>
                    <th className="p-2">Tenant-Modell</th>
                    <th className="p-2">Content-Klasse</th>
                    <th className="p-2">Public</th>
                    <th className="p-2">Objekte</th>
                    <th className="p-2">Open</th>
                    <th className="p-2">High</th>
                    <th className="p-2">Maturity</th>
                    <th className="p-2">Zuletzt gesehen</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b) => (
                    <tr key={b.bucket_id} className="border-b hover:bg-muted/40">
                      <td className="p-2 font-mono">{b.bucket_id}</td>
                      <td className="p-2">{b.tenant_model}</td>
                      <td className="p-2">
                        <Badge variant={["learner_data","certificate","assessment","exam_content"].includes(b.content_class) ? "destructive" : "secondary"}>
                          {b.content_class}
                        </Badge>
                      </td>
                      <td className="p-2">
                        {b.is_public ? (
                          <Badge variant="destructive">public</Badge>
                        ) : (
                          <Badge variant="outline">private</Badge>
                        )}
                      </td>
                      <td className="p-2">{b.observed_object_count ?? "—"}</td>
                      <td className="p-2">{b.open_findings}</td>
                      <td className="p-2">{b.high_open_findings}</td>
                      <td className="p-2">
                        <Badge variant={(matColor[b.maturity] as any) ?? "outline"}>{b.maturity}</Badge>
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {b.last_seen_at ? new Date(b.last_seen_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                  {!loading && buckets.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-6 text-center text-muted-foreground">
                        Noch kein Audit gelaufen. Klick „Audit starten".
                      </td>
                    </tr>
                  )}

                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="findings">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="p-2">Zeit</th>
                    <th className="p-2">Bucket</th>
                    <th className="p-2">Content</th>
                    <th className="p-2">Typ</th>
                    <th className="p-2">Severity</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Pfad-Sample</th>
                    <th className="p-2">Empfehlung</th>
                  </tr>
                </thead>
                <tbody>

                  {findings.map((f) => (
                    <tr key={f.id} className="border-b align-top hover:bg-muted/40">
                      <td className="p-2 whitespace-nowrap">{new Date(f.created_at).toLocaleString()}</td>
                      <td className="p-2 font-mono">{f.bucket_id}</td>
                      <td className="p-2">
                        <Badge variant={["learner_data","certificate","assessment","exam_content"].includes(f.content_class) ? "destructive" : "secondary"}>
                          {f.content_class}
                        </Badge>
                      </td>
                      <td className="p-2">{f.finding_type}</td>
                      <td className="p-2">
                        <Badge variant={(sevColor[f.severity] as any) ?? "outline"}>{f.severity}</Badge>
                      </td>
                      <td className="p-2">{f.status}</td>
                      <td className="p-2 font-mono break-all max-w-[260px]">{f.path_sample ?? "—"}</td>
                      <td className="p-2 max-w-[360px]">{f.recommendation ?? "—"}</td>
                    </tr>
                  ))}
                  {!loading && findings.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-muted-foreground">
                        Keine Findings.
                      </td>
                    </tr>
                  )}

                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="p-2">Start</th>
                    <th className="p-2">Quelle</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Buckets</th>
                    <th className="p-2">Objekte</th>
                    <th className="p-2">Findings</th>
                    <th className="p-2">Fertig</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="p-2 whitespace-nowrap">{new Date(r.started_at).toLocaleString()}</td>
                      <td className="p-2">{r.source}</td>
                      <td className="p-2">
                        <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
                      </td>
                      <td className="p-2">{r.buckets_scanned ?? "—"}</td>
                      <td className="p-2">{r.objects_sampled ?? "—"}</td>
                      <td className="p-2">{r.findings_count ?? "—"}</td>
                      <td className="p-2 whitespace-nowrap">
                        {r.finished_at ? new Date(r.finished_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold ${accent ? "text-destructive" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
