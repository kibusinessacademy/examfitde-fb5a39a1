import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ShieldCheck, Loader2, RefreshCcw, Lock, Swords, AlertTriangle, Download, FileJson, FileSpreadsheet, ShieldAlert, Unlock } from "lucide-react";
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
  objects_planned: number | null;
  cleanup_count: number | null;
  cleanup_ok: boolean | null;
  findings_count: number | null;
  started_at: string;
  finished_at: string | null;
  source: string;
  run_kind?: string | null;
  allowed_buckets?: string[] | null;
  excluded_buckets?: string[] | null;
  blocked_reason?: string | null;
  run_log?: any;
  summary?: any;
};

const sevColor: Record<string, string> = {
  critical: "destructive", high: "destructive", medium: "default", low: "secondary", info: "outline",
};
const matColor: Record<string, string> = {
  bronze: "destructive", silver: "secondary", gold: "default", platinum: "default",
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

type TopByClass = {
  content_class: string;
  leak_count: number;
  buckets_affected: number;
  objects_affected: number;
  risk_score: number;
  last_seen_at: string;
  bucket_ids: string[];
  attack_types: string[];
};

type LastRun = Run & { block_next_full_run: boolean };

type AttackClass = {
  id: string;
  class_key: string;
  display_name: string;
  description: string | null;
  phase: string;
  default_severity: string;
  enabled: boolean;
  kill_switch: boolean;
  synth_only: boolean;
};

type ByClassRow = {
  attack_class: string;
  content_class: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  total_findings: number;
  risk_score: number;
  last_seen_at: string | null;
};

const SENSITIVE = ["learner_data", "certificate", "assessment", "exam_content"];

export default function StorageRealityPage() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [attackKpis, setAttackKpis] = useState<AttackKpis | null>(null);
  const [attackResults, setAttackResults] = useState<AttackResultRow[]>([]);
  const [policy, setPolicy] = useState<AttackPolicy | null>(null);
  const [topByClass, setTopByClass] = useState<TopByClass[]>([]);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [attackClasses, setAttackClasses] = useState<AttackClass[]>([]);
  const [byClassRows, setByClassRows] = useState<ByClassRow[]>([]);
  const [running, setRunning] = useState(false);
  const [attacking, setAttacking] = useState(false);
  const [attackingP2, setAttackingP2] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [bRes, fRes, rRes, kRes, akRes, arRes, pRes, tRes, lRes, acRes, bcRes] = await Promise.all([
      (supabase as any).from("v_admin_storage_bucket_maturity").select("*"),
      (supabase as any).from("storage_rls_audit_findings").select("*").order("created_at", { ascending: false }).limit(200),
      (supabase as any).from("storage_audit_runs").select("*").order("started_at", { ascending: false }).limit(20),
      (supabase as any).from("v_admin_storage_audit_kpis").select("*").maybeSingle(),
      (supabase as any).from("v_admin_storage_attack_kpis").select("*").maybeSingle(),
      (supabase as any).from("storage_attack_run_results").select("*").order("created_at", { ascending: false }).limit(500),
      (supabase as any).from("storage_attack_policies").select("*").limit(1).maybeSingle(),
      (supabase as any).from("v_admin_storage_attack_top_findings_by_class").select("*"),
      (supabase as any).from("v_admin_storage_attack_last_run").select("*").maybeSingle(),
      (supabase as any).from("storage_attack_classes").select("*").order("class_key"),
      (supabase as any).from("v_admin_storage_attack_by_class").select("*"),
    ]);
    if (!bRes.error) setBuckets(bRes.data ?? []);
    if (!fRes.error) setFindings(fRes.data ?? []);
    if (!rRes.error) setRuns(rRes.data ?? []);
    if (!kRes.error) setKpis(kRes.data ?? null);
    if (!akRes.error) setAttackKpis(akRes.data ?? null);
    if (!arRes.error) setAttackResults(arRes.data ?? []);
    if (!pRes.error) setPolicy(pRes.data ?? null);
    if (!tRes.error) setTopByClass(tRes.data ?? []);
    if (!lRes.error) setLastRun(lRes.data ?? null);
    if (!acRes.error) setAttackClasses(acRes.data ?? []);
    if (!bcRes.error) setByClassRows(bcRes.data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function runAudit() {
    setRunning(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("storage-reality-audit", { body: { sample_size: 50 } });
      if (error) throw error;
      toast.success(`Audit fertig — ${data.buckets_scanned} Buckets, ${data.objects_sampled} Objekte, ${data.findings} Findings`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Audit fehlgeschlagen"); }
    finally { setRunning(false); }
  }

  async function runAttack() {
    if (!policy?.enabled) { toast.error("Kill-Switch ist aus. Erst Attack-Simulation aktivieren."); return; }
    const isFull = (policy.allowed_buckets?.length ?? 0) === 0;
    if (isFull && lastRun?.block_next_full_run) {
      toast.error("Voll-Lauf blockiert — letzter Run hatte Cleanup-Mismatch. Erst freigeben.");
      return;
    }
    if (!confirm("Synthetische Attack-Simulation starten? Schreibt nur unter __storage_audit__/<run_id>/ und räumt am Ende auf.")) return;
    setAttacking(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("storage-attack-simulator", { body: {} });
      if (error) throw error;
      toast.success(`Attack fertig — ${data.attacks_run} Angriffe, ${data.leaks} Leaks, ${data.cleaned}/${data.objects_planned} Objekte aufgeräumt`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Attack-Simulation fehlgeschlagen"); }
    finally { setAttacking(false); }
  }

  async function toggleKillSwitch(next: boolean) {
    if (!policy) return;
    const { error } = await (supabase as any).from("storage_attack_policies")
      .update({ enabled: next, updated_at: new Date().toISOString() }).eq("id", policy.id);
    if (error) { toast.error(error.message); return; }
    setPolicy({ ...policy, enabled: next });
    toast.success(next ? "Attack-Simulation aktiviert" : "Attack-Simulation deaktiviert");
  }

  async function toggleAttackClass(c: AttackClass, field: "enabled" | "kill_switch", next: boolean) {
    const patch: any = { [field]: next, updated_at: new Date().toISOString() };
    const { error } = await (supabase as any)
      .from("storage_attack_classes").update(patch).eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    setAttackClasses((prev) => prev.map((x) => x.id === c.id ? { ...x, ...patch } : x));
    toast.success(`${c.class_key}: ${field} = ${next}`);
  }

  async function runPhase2Attack() {
    if (!policy?.enabled) { toast.error("Globaler Kill-Switch aus."); return; }
    const armed = attackClasses.filter((c) => c.phase === "2.0" && c.enabled && !c.kill_switch);
    if (armed.length === 0) { toast.error("Keine Phase-2.0-Klasse aktiv (Enabled + Kill-Switch off)."); return; }
    if (!confirm(`Phase 2.0 Tenant-Reality starten?\nAktiv: ${armed.map((c) => c.class_key).join(", ")}\nNur Synth-Tenants. Hard-Allowlist server-seitig (seo_assets, media_uploads, system_assets).`)) return;
    setAttackingP2(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("storage-tenant-attack-simulator", { body: {} });
      if (error) throw error;
      toast.success(`Phase 2.0 fertig — ${data.attacks_run} Attacks, ${data.leaks} Leaks, ${data.cleaned}/${data.objects_planned} Objekte aufgeräumt`);
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Phase-2.0-Attack fehlgeschlagen"); }
    finally { setAttackingP2(false); }
  }

  async function clearBlock() {
    if (!lastRun) return;
    const note = prompt("Notiz zur manuellen Freigabe (z.B. 'Synth-Reste manuell gelöscht'):") ?? "";
    const { error } = await (supabase as any).rpc("admin_storage_attack_clear_block", { _run_id: lastRun.id, _note: note });
    if (error) { toast.error(error.message); return; }
    toast.success("Block aufgehoben");
    await load();
  }

  function downloadRunJson(run: Run) {
    const results = attackResults.filter((r) => r.run_id === run.id);
    const payload = { run, results };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    triggerDownload(blob, `storage-attack-${run.id}.json`);
  }

  function downloadRunCsv(run: Run) {
    const results = attackResults.filter((r) => r.run_id === run.id);
    const header = ["created_at","bucket_id","content_class","attack_type","result","severity","synthetic_tenant","target_path","evidence"];
    const rows = results.map((r) => [
      r.created_at, r.bucket_id, r.content_class, r.attack_type, r.result, r.severity,
      r.synthetic_tenant ?? "", r.target_path ?? "", JSON.stringify(r.evidence ?? {}),
    ]);
    const csv = [header, ...rows].map((row) =>
      row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    triggerDownload(new Blob([csv], { type: "text/csv" }), `storage-attack-${run.id}.csv`);
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const score = (() => {
    if (buckets.length === 0) return 0;
    const weight = { bronze: 0, silver: 50, gold: 80, platinum: 100 } as Record<string, number>;
    return Math.round(buckets.reduce((s, b) => s + (weight[b.maturity] ?? 0), 0) / buckets.length);
  })();

  const attackRuns = runs.filter((r) => (r as any).run_kind === "attack" || r.source === "admin_ui_attack");
  const isFullRunMode = (policy?.allowed_buckets?.length ?? 0) === 0;
  const blocked = isFullRunMode && lastRun?.block_next_full_run;

  return (
    <div className="container py-6 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Storage Reality Audit</h1>
            <p className="text-sm text-muted-foreground">Phase 0 read-only Inventar · Phase 1.1 Attack-Simulation mit Cleanup-Blocker & Export.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Lock className="h-3 w-3" /> {policy?.enabled ? "attacks armed" : "read-only"}
          </Badge>
          <Button variant="outline" onClick={runAudit} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            <span className="ml-2">Audit starten</span>
          </Button>
          <Button onClick={runAttack} disabled={attacking || !policy?.enabled || !!blocked} variant={policy?.enabled ? "destructive" : "secondary"}>
            {attacking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Swords className="h-4 w-4" />}
            <span className="ml-2">Attack starten</span>
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

      <Tabs defaultValue="buckets">
        <TabsList>
          <TabsTrigger value="buckets">Buckets</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="attacks">
            Attacks
            {attackKpis && attackKpis.total_leaks > 0 && (<Badge variant="destructive" className="ml-2">{attackKpis.total_leaks}</Badge>)}
            {blocked && (<Badge variant="destructive" className="ml-2 gap-1"><ShieldAlert className="h-3 w-3" />blocked</Badge>)}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="buckets">
          <Card><CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr className="border-b">
                <th className="p-2">Bucket</th><th className="p-2">Tenant-Modell</th><th className="p-2">Content-Klasse</th>
                <th className="p-2">Public</th><th className="p-2">Objekte</th><th className="p-2">Open</th>
                <th className="p-2">High</th><th className="p-2">Maturity</th><th className="p-2">Zuletzt gesehen</th>
              </tr></thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.bucket_id} className="border-b hover:bg-muted/40">
                    <td className="p-2 font-mono">{b.bucket_id}</td>
                    <td className="p-2">{b.tenant_model}</td>
                    <td className="p-2"><Badge variant={SENSITIVE.includes(b.content_class) ? "destructive" : "secondary"}>{b.content_class}</Badge></td>
                    <td className="p-2">{b.is_public ? <Badge variant="destructive">public</Badge> : <Badge variant="outline">private</Badge>}</td>
                    <td className="p-2">{b.observed_object_count ?? "—"}</td>
                    <td className="p-2">{b.open_findings}</td>
                    <td className="p-2">{b.high_open_findings}</td>
                    <td className="p-2"><Badge variant={(matColor[b.maturity] as any) ?? "outline"}>{b.maturity}</Badge></td>
                    <td className="p-2 whitespace-nowrap">{b.last_seen_at ? new Date(b.last_seen_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
                {!loading && buckets.length === 0 && (<tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Noch kein Audit gelaufen.</td></tr>)}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="findings">
          <Card><CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr className="border-b">
                <th className="p-2">Zeit</th><th className="p-2">Bucket</th><th className="p-2">Content</th><th className="p-2">Typ</th>
                <th className="p-2">Severity</th><th className="p-2">Status</th><th className="p-2">Pfad-Sample</th><th className="p-2">Empfehlung</th>
              </tr></thead>
              <tbody>
                {findings.map((f) => (
                  <tr key={f.id} className="border-b align-top hover:bg-muted/40">
                    <td className="p-2 whitespace-nowrap">{new Date(f.created_at).toLocaleString()}</td>
                    <td className="p-2 font-mono">{f.bucket_id}</td>
                    <td className="p-2"><Badge variant={SENSITIVE.includes(f.content_class) ? "destructive" : "secondary"}>{f.content_class}</Badge></td>
                    <td className="p-2">{f.finding_type}</td>
                    <td className="p-2"><Badge variant={(sevColor[f.severity] as any) ?? "outline"}>{f.severity}</Badge></td>
                    <td className="p-2">{f.status}</td>
                    <td className="p-2 font-mono break-all max-w-[260px]">{f.path_sample ?? "—"}</td>
                    <td className="p-2 max-w-[360px]">{f.recommendation ?? "—"}</td>
                  </tr>
                ))}
                {!loading && findings.length === 0 && (<tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Keine Findings.</td></tr>)}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="runs">
          <Card><CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr className="border-b">
                <th className="p-2">Start</th><th className="p-2">Quelle</th><th className="p-2">Status</th>
                <th className="p-2">Buckets</th><th className="p-2">Geplant/Gesampelt</th><th className="p-2">Cleanup</th>
                <th className="p-2">Findings</th><th className="p-2">Fertig</th>
              </tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2 whitespace-nowrap">{new Date(r.started_at).toLocaleString()}</td>
                    <td className="p-2">{r.source}</td>
                    <td className="p-2"><Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge></td>
                    <td className="p-2">{r.buckets_scanned ?? "—"}</td>
                    <td className="p-2">{(r.objects_planned ?? "—") + " / " + (r.objects_sampled ?? "—")}</td>
                    <td className="p-2">
                      {r.cleanup_ok === null || r.cleanup_ok === undefined ? "—" :
                        r.cleanup_ok ? <Badge variant="default">{r.cleanup_count}</Badge> :
                        <Badge variant="destructive">{r.cleanup_count}/{r.objects_sampled}</Badge>}
                    </td>
                    <td className="p-2">{r.findings_count ?? "—"}</td>
                    <td className="p-2 whitespace-nowrap">{r.finished_at ? new Date(r.finished_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="attacks" className="space-y-4">
          {/* Kill-switch + KPIs */}
          <Card><CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-amber-600" />Synthetic Attack Kill-Switch</div>
                <div className="text-xs text-muted-foreground">
                  Schreibt nur unter <code className="font-mono">{policy?.synthetic_prefix ?? "__storage_audit__"}/&lt;run_id&gt;/</code> · garantiertes Cleanup · Block-Gate aktiv.
                </div>
              </div>
              <Switch checked={policy?.enabled ?? false} onCheckedChange={toggleKillSwitch} disabled={!policy} />
            </div>
            {attackKpis && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
                <Stat label="Attack Runs" value={attackKpis.total_attack_runs} />
                <Stat label="Ergebnisse" value={attackKpis.total_attack_results} />
                <Stat label="Leaks" value={attackKpis.total_leaks} accent={attackKpis.total_leaks > 0} />
                <Stat label="High/Critical Leaks" value={attackKpis.critical_leaks} accent={attackKpis.critical_leaks > 0} />
                <Stat label="Buckets mit Leaks" value={attackKpis.buckets_with_leaks} accent={attackKpis.buckets_with_leaks > 0} />
              </div>
            )}
          </CardContent></Card>

          {/* Block-Banner */}
          {blocked && lastRun && (
            <Card className="border-destructive">
              <CardContent className="p-4 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-destructive"><ShieldAlert className="h-4 w-4" />Voll-Lauf blockiert</div>
                  <div className="text-xs text-muted-foreground">{lastRun.blocked_reason ?? "Cleanup-Mismatch im letzten Run."}</div>
                  <div className="text-xs">sampled: <b>{lastRun.objects_sampled}</b> · cleaned: <b>{lastRun.cleanup_count}</b> · cleanup_ok: <b>{String(lastRun.cleanup_ok)}</b></div>
                </div>
                <Button size="sm" variant="outline" onClick={clearBlock}><Unlock className="h-4 w-4 mr-2" />Manuell freigeben</Button>
              </CardContent>
            </Card>
          )}

          {/* Phase 2.0 — Tenant-Reality Attack Classes */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Swords className="h-4 w-4 text-amber-600" />
                  Phase 2.0 · Tenant-Reality Attacks
                </CardTitle>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Synth-only · Hard-Allowlist (seo_assets, media_uploads, system_assets) · keine sensiblen Klassen.
                </div>
              </div>
              <Button
                size="sm"
                variant={attackClasses.some((c) => c.phase === "2.0" && c.enabled && !c.kill_switch) ? "destructive" : "secondary"}
                onClick={runPhase2Attack}
                disabled={attackingP2 || !policy?.enabled || !!blocked}
              >
                {attackingP2 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Swords className="h-4 w-4" />}
                <span className="ml-2">Phase 2.0 starten</span>
              </Button>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground"><tr className="border-b">
                  <th className="p-2">Klasse</th><th className="p-2">Beschreibung</th><th className="p-2">Severity</th>
                  <th className="p-2">Enabled</th><th className="p-2">Kill-Switch</th>
                </tr></thead>
                <tbody>
                  {attackClasses.filter((c) => c.phase === "2.0").map((c) => (
                    <tr key={c.id} className="border-b align-top">
                      <td className="p-2 font-mono whitespace-nowrap">{c.class_key}</td>
                      <td className="p-2 max-w-[420px] text-muted-foreground">{c.description ?? "—"}</td>
                      <td className="p-2"><Badge variant={(sevColor[c.default_severity] as any) ?? "outline"}>{c.default_severity}</Badge></td>
                      <td className="p-2"><Switch checked={c.enabled} onCheckedChange={(v) => toggleAttackClass(c, "enabled", v)} /></td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <Switch checked={!c.kill_switch} onCheckedChange={(v) => toggleAttackClass(c, "kill_switch", !v)} />
                          <span className="text-[10px] text-muted-foreground">{c.kill_switch ? "armed-OFF" : "armed-ON"}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {attackClasses.filter((c) => c.phase === "2.0").length === 0 && (
                    <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Keine Attack-Klassen registriert.</td></tr>
                  )}
                </tbody>
              </table>
              {byClassRows.length > 0 && (
                <div className="p-3 border-t">
                  <div className="text-[11px] font-semibold mb-2">Findings je Attack × Content-Klasse</div>
                  <table className="w-full text-[11px]">
                    <thead className="text-left text-muted-foreground"><tr className="border-b">
                      <th className="p-1">Attack</th><th className="p-1">Content</th><th className="p-1">Risk</th>
                      <th className="p-1">Crit</th><th className="p-1">High</th><th className="p-1">Med</th><th className="p-1">Low</th><th className="p-1">Total</th><th className="p-1">Zuletzt</th>
                    </tr></thead>
                    <tbody>
                      {byClassRows.map((r, i) => (
                        <tr key={i} className="border-b">
                          <td className="p-1 font-mono">{r.attack_class}</td>
                          <td className="p-1"><Badge variant={SENSITIVE.includes(r.content_class) ? "destructive" : "secondary"}>{r.content_class}</Badge></td>
                          <td className="p-1 font-semibold">{r.risk_score}</td>
                          <td className="p-1">{r.critical_count}</td>
                          <td className="p-1">{r.high_count}</td>
                          <td className="p-1">{r.medium_count}</td>
                          <td className="p-1">{r.low_count}</td>
                          <td className="p-1">{r.total_findings}</td>
                          <td className="p-1 whitespace-nowrap">{r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Findings by Content-Class */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Top Leaks nach Content-Klasse</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground"><tr className="border-b">
                  <th className="p-2">Content-Klasse</th><th className="p-2">Risk-Score</th><th className="p-2">Leaks</th>
                  <th className="p-2">Buckets</th><th className="p-2">Objekte</th><th className="p-2">Attack-Typen</th><th className="p-2">Zuletzt</th>
                </tr></thead>
                <tbody>
                  {topByClass.map((t) => (
                    <tr key={t.content_class} className="border-b">
                      <td className="p-2"><Badge variant={SENSITIVE.includes(t.content_class) ? "destructive" : "secondary"}>{t.content_class}</Badge></td>
                      <td className="p-2 font-semibold">{t.risk_score}</td>
                      <td className="p-2">{t.leak_count}</td>
                      <td className="p-2 font-mono text-[10px] break-all max-w-[200px]">{(t.bucket_ids ?? []).join(", ")}</td>
                      <td className="p-2">{t.objects_affected}</td>
                      <td className="p-2 text-[10px]">{(t.attack_types ?? []).join(", ")}</td>
                      <td className="p-2 whitespace-nowrap">{t.last_seen_at ? new Date(t.last_seen_at).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                  {topByClass.length === 0 && (<tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Keine Leaks erkannt.</td></tr>)}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Attack Runs mit Export + Logs */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Attack Runs · Export & Logs</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground"><tr className="border-b">
                  <th className="p-2">Start/Stop</th><th className="p-2">Buckets</th><th className="p-2">Geplant/Gesampelt</th>
                  <th className="p-2">Cleanup</th><th className="p-2">Leaks</th><th className="p-2">Block</th><th className="p-2">Export</th>
                </tr></thead>
                <tbody>
                  {attackRuns.map((r) => {
                    const isOpen = expandedRun === r.id;
                    return (
                      <>
                        <tr key={r.id} className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => setExpandedRun(isOpen ? null : r.id)}>
                          <td className="p-2 whitespace-nowrap">
                            <div>{new Date(r.started_at).toLocaleString()}</div>
                            <div className="text-muted-foreground">{r.finished_at ? new Date(r.finished_at).toLocaleString() : "—"}</div>
                          </td>
                          <td className="p-2">{r.buckets_scanned ?? "—"}</td>
                          <td className="p-2">{(r.objects_planned ?? 0)} / {(r.objects_sampled ?? 0)}</td>
                          <td className="p-2">
                            {r.cleanup_ok === null || r.cleanup_ok === undefined ? "—" :
                              r.cleanup_ok ? <Badge variant="default">{r.cleanup_count} ok</Badge> :
                              <Badge variant="destructive" className="gap-1"><ShieldAlert className="h-3 w-3" />{r.cleanup_count}/{r.objects_sampled}</Badge>}
                          </td>
                          <td className="p-2">{r.findings_count ?? 0}</td>
                          <td className="p-2">{r.blocked_reason ? <Badge variant="destructive">blocked</Badge> : <Badge variant="outline">—</Badge>}</td>
                          <td className="p-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="ghost" onClick={() => downloadRunJson(r)}><FileJson className="h-3 w-3 mr-1" />JSON</Button>
                            <Button size="sm" variant="ghost" onClick={() => downloadRunCsv(r)}><FileSpreadsheet className="h-3 w-3 mr-1" />CSV</Button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={r.id + "-log"} className="border-b bg-muted/20">
                            <td colSpan={7} className="p-3 space-y-2">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                                <Kv k="allowed_buckets" v={(r.allowed_buckets ?? []).join(", ") || "(alle privaten)"} />
                                <Kv k="excluded_buckets" v={(r.excluded_buckets ?? []).join(", ") || "—"} />
                                <Kv k="cleanup_ok" v={String(r.cleanup_ok)} />
                                <Kv k="blocked_reason" v={r.blocked_reason ?? "—"} />
                              </div>
                              <div>
                                <div className="text-[11px] font-semibold mb-1">Run-Log</div>
                                <pre className="text-[10px] font-mono bg-background p-2 rounded border overflow-x-auto max-h-[280px]">
{JSON.stringify(r.run_log ?? [], null, 2)}
                                </pre>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {attackRuns.length === 0 && (<tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Noch keine Attack-Runs.</td></tr>)}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Attack Results */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Letzte Ergebnisse</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground"><tr className="border-b">
                  <th className="p-2">Zeit</th><th className="p-2">Bucket</th><th className="p-2">Content</th><th className="p-2">Attack</th>
                  <th className="p-2">Ergebnis</th><th className="p-2">Severity</th><th className="p-2">Tenant</th><th className="p-2">Pfad</th><th className="p-2">Evidence</th>
                </tr></thead>
                <tbody>
                  {attackResults.slice(0, 100).map((a) => (
                    <tr key={a.id} className="border-b align-top hover:bg-muted/40">
                      <td className="p-2 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                      <td className="p-2 font-mono">{a.bucket_id}</td>
                      <td className="p-2"><Badge variant={SENSITIVE.includes(a.content_class) ? "destructive" : "secondary"}>{a.content_class}</Badge></td>
                      <td className="p-2">{a.attack_type}</td>
                      <td className="p-2"><Badge variant={a.result === "leak" ? "destructive" : a.result === "pass" ? "default" : "secondary"}>{a.result}</Badge></td>
                      <td className="p-2"><Badge variant={(sevColor[a.severity] as any) ?? "outline"}>{a.severity}</Badge></td>
                      <td className="p-2">{a.synthetic_tenant ?? "—"}</td>
                      <td className="p-2 font-mono break-all max-w-[260px]">{a.target_path ?? "—"}</td>
                      <td className="p-2 max-w-[280px] font-mono text-[10px] break-all">{a.evidence ? JSON.stringify(a.evidence) : "—"}</td>
                    </tr>
                  ))}
                  {!loading && attackResults.length === 0 && (<tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Noch keine Attack-Ergebnisse.</td></tr>)}
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
      <CardHeader className="pb-2"><CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent><div className={`text-2xl font-semibold ${accent ? "text-destructive" : ""}`}>{value}</div></CardContent>
    </Card>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono break-all">{v}</span>
    </div>
  );
}
