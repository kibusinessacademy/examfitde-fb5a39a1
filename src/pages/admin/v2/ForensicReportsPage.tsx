import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle, Clock, RefreshCw, Shield, Search, Zap, Filter } from "lucide-react";
import { toast } from "sonner";

interface ForensicReport {
  id: string;
  package_id: string;
  report_type: string;
  status: string;
  summary: string;
  root_cause_class: string | null;
  root_cause_confidence: number;
  healability: string;
  auto_heal_allowed: boolean;
  recommended_actions: any[];
  causal_chain: any[];
  impacted_steps: any[];
  impacted_jobs: any[];
  symptom_snapshot: any;
  governance_state: any;
  artifact_state: any;
  created_at: string;
  cert_title?: string;
  cert_slug?: string;
}

interface ForensicFinding {
  id: string;
  report_id: string;
  finding_type: string;
  severity: string;
  code: string;
  title: string;
  details: any;
  created_at: string;
}

const HEALABILITY_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  auto_healable: { label: "Auto-Healable", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: Zap },
  manual_review: { label: "Manual Review", color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: Search },
  hard_blocked: { label: "Hard Blocked", color: "bg-red-500/20 text-red-400 border-red-500/30", icon: Shield },
  unknown: { label: "Unknown", color: "bg-muted text-muted-foreground", icon: Clock },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  warning: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  info: "bg-sky-500/20 text-sky-400 border-sky-500/30",
};

const ROOT_CAUSE_LABELS: Record<string, string> = {
  STALE_LOCK_FALSE_ACTIVE: "Stale Lock",
  GOVERNANCE_BLOCK: "Governance Block",
  QUALITY_GATE_BLOCK: "Quality Gate",
  UPSTREAM_VARIANTS_MISSING: "Upstream Missing",
  QUEUE_POLICY_MISMATCH: "Queue Mismatch",
  NO_SOURCE_BLUEPRINTS: "No Blueprints",
  MAPPING_MISMATCH: "Mapping Error",
  PROMOTION_WRITE_FAILED: "Promotion Failed",
  POSTCONDITION_FALSE_NEGATIVE: "False Postcondition",
  WORKER_POOL_MISMATCH: "Pool Mismatch",
  PAYLOAD_CONTRACT_MISMATCH: "Payload Error",
  DUPLICATE_ORPHAN_PROCESSING: "Duplicate Processing",
  FALSE_FINALIZATION: "False Finalization",
  MATERIALIZATION_GUARD_BLOCK: "Mat. Guard",
  ACCESS_OR_ENTITLEMENT_BLOCK: "Access Block",
  UNKNOWN_NEEDS_MANUAL_REVIEW: "Unknown",
};

export default function ForensicReportsPage() {
  const [reports, setReports] = useState<ForensicReport[]>([]);
  const [findings, setFindings] = useState<ForensicFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<ForensicReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [filterHealability, setFilterHealability] = useState<string>("all");
  const [filterRootCause, setFilterRootCause] = useState<string>("all");

  const fetchReports = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("ops_open_forensic_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setReports(data || []);
    setLoading(false);
  }, []);

  const fetchFindings = useCallback(async (reportId: string) => {
    const { data } = await (supabase as any)
      .from("ops_forensic_findings")
      .select("*")
      .eq("report_id", reportId)
      .order("created_at", { ascending: true });
    setFindings(data || []);
  }, []);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  useEffect(() => {
    if (selectedReport) fetchFindings(selectedReport.id);
    else setFindings([]);
  }, [selectedReport, fetchFindings]);

  const generateReport = async (packageId: string) => {
    setGenerating(true);
    try {
      const { data, error } = await (supabase as any).rpc("fn_generate_package_forensic_report", {
        p_package_id: packageId,
      });
      if (error) throw error;
      toast.success(`Report generiert: ${data?.root_cause || "Analyse abgeschlossen"}`);
      fetchReports();
    } catch (e: any) {
      toast.error(`Fehler: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const resolveReport = async (reportId: string) => {
    await (supabase as any)
      .from("ops_forensic_reports")
      .update({ status: "resolved", updated_at: new Date().toISOString() })
      .eq("id", reportId);
    toast.success("Report als resolved markiert");
    fetchReports();
    if (selectedReport?.id === reportId) setSelectedReport(null);
  };

  // Apply filters
  const filteredReports = reports.filter(r => {
    if (filterHealability !== "all" && r.healability !== filterHealability) return false;
    if (filterRootCause !== "all" && r.root_cause_class !== filterRootCause) return false;
    return true;
  });

  const groupedReports = {
    hard_blocked: reports.filter(r => r.healability === "hard_blocked"),
    manual_review: reports.filter(r => r.healability === "manual_review"),
    auto_healable: reports.filter(r => r.healability === "auto_healable"),
    unknown: reports.filter(r => r.healability === "unknown"),
  };

  const uniqueRootCauses = [...new Set(reports.map(r => r.root_cause_class).filter(Boolean))];

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Forensic Reports</h1>
          <p className="text-sm text-muted-foreground">Kausale Diagnosen für Pipeline-Anomalien</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchReports} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Aktualisieren
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["hard_blocked", "manual_review", "auto_healable", "unknown"] as const).map(key => {
          const cfg = HEALABILITY_CONFIG[key];
          const Icon = cfg.icon;
          return (
            <Card key={key} className="border-border/50">
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold">{groupedReports[key].length}</p>
                  <p className="text-xs text-muted-foreground">{cfg.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={filterHealability} onValueChange={setFilterHealability}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Healability" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Healability</SelectItem>
            <SelectItem value="hard_blocked">Hard Blocked</SelectItem>
            <SelectItem value="manual_review">Manual Review</SelectItem>
            <SelectItem value="auto_healable">Auto-Healable</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterRootCause} onValueChange={setFilterRootCause}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Root Cause" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Root Causes</SelectItem>
            {uniqueRootCauses.map(rc => (
              <SelectItem key={rc!} value={rc!}>{ROOT_CAUSE_LABELS[rc!] || rc}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Report List */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Offene Reports ({filteredReports.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[600px]">
                {filteredReports.map(r => {
                  const cfg = HEALABILITY_CONFIG[r.healability] || HEALABILITY_CONFIG.unknown;
                  return (
                    <div
                      key={r.id}
                      className={`p-3 border-b border-border/30 cursor-pointer hover:bg-muted/30 transition ${
                        selectedReport?.id === r.id ? "bg-muted/50" : ""
                      }`}
                      onClick={() => setSelectedReport(r)}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={`text-[10px] ${cfg.color}`}>
                          {cfg.label}
                        </Badge>
                        {r.root_cause_class && (
                          <Badge variant="outline" className="text-[10px]">
                            {ROOT_CAUSE_LABELS[r.root_cause_class] || r.root_cause_class}
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {Math.round(r.root_cause_confidence * 100)}%
                        </span>
                      </div>
                      <p className="text-sm font-medium truncate">{r.cert_title || r.package_id.slice(0, 8)}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {new Date(r.created_at).toLocaleString("de-DE")}
                      </p>
                    </div>
                  );
                })}
                {filteredReports.length === 0 && !loading && (
                  <p className="p-4 text-sm text-muted-foreground text-center">Keine offenen Reports</p>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Report Detail */}
        <div className="lg:col-span-2">
          {selectedReport ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">{selectedReport.cert_title}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{selectedReport.summary}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => generateReport(selectedReport.package_id)} disabled={generating}>
                      <RefreshCw className="h-3 w-3 mr-1" /> Neu analysieren
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => resolveReport(selectedReport.id)}>
                      <CheckCircle className="h-3 w-3 mr-1" /> Resolved
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="diagnosis">
                  <TabsList className="mb-4">
                    <TabsTrigger value="diagnosis">Diagnose</TabsTrigger>
                    <TabsTrigger value="findings">Findings ({findings.length})</TabsTrigger>
                    <TabsTrigger value="chain">Kausalkette</TabsTrigger>
                    <TabsTrigger value="steps">Steps</TabsTrigger>
                    <TabsTrigger value="jobs">Jobs</TabsTrigger>
                    <TabsTrigger value="actions">Aktionen</TabsTrigger>
                  </TabsList>

                  <TabsContent value="diagnosis" className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-muted/20 rounded p-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Root Cause</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">
                            {ROOT_CAUSE_LABELS[selectedReport.root_cause_class || ""] || selectedReport.root_cause_class || "—"}
                          </Badge>
                        </div>
                      </div>
                      <InfoCard label="Confidence" value={`${Math.round(selectedReport.root_cause_confidence * 100)}%`} />
                      <div className="bg-muted/20 rounded p-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Healability</p>
                        <div className="mt-1">
                          <Badge variant="outline" className={`text-xs ${HEALABILITY_CONFIG[selectedReport.healability]?.color || ''}`}>
                            {HEALABILITY_CONFIG[selectedReport.healability]?.label || selectedReport.healability}
                          </Badge>
                        </div>
                      </div>
                      <div className="bg-muted/20 rounded p-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Auto-Heal</p>
                        <Badge variant={selectedReport.auto_heal_allowed ? "default" : "secondary"} className="text-xs mt-1">
                          {selectedReport.auto_heal_allowed ? "✓ Erlaubt" : "✗ Blockiert"}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium mb-2">Governance</h4>
                      <pre className="text-xs bg-muted/30 p-3 rounded overflow-auto max-h-48">
                        {JSON.stringify(selectedReport.governance_state, null, 2)}
                      </pre>
                    </div>
                  </TabsContent>

                  {/* NEW: Findings Tab with readable cards */}
                  <TabsContent value="findings">
                    <ScrollArea className="h-[500px]">
                      <div className="space-y-3">
                        {findings.map(f => (
                          <Card key={f.id} className="border-border/30">
                            <CardContent className="p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline" className={`text-[10px] ${SEVERITY_COLORS[f.severity] || ''}`}>
                                  {f.severity}
                                </Badge>
                                <Badge variant="outline" className="text-[10px]">
                                  {f.finding_type}
                                </Badge>
                                <span className="text-xs font-mono font-medium">{f.code}</span>
                              </div>
                              <p className="text-sm font-medium">{f.title}</p>
                              {f.details && Object.keys(f.details).length > 0 && (
                                <pre className="text-[10px] mt-2 text-muted-foreground bg-muted/20 p-2 rounded overflow-auto max-h-32">
                                  {JSON.stringify(f.details, null, 2)}
                                </pre>
                              )}
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {new Date(f.created_at).toLocaleString("de-DE")}
                              </p>
                            </CardContent>
                          </Card>
                        ))}
                        {findings.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-4">Keine Findings</p>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="chain">
                    <div className="space-y-3">
                      {(selectedReport.causal_chain || []).map((item: any, i: number) => (
                        <Card key={i} className="border-border/30">
                          <CardContent className="p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className={`text-[10px] ${
                                item.type === 'root_cause' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                                item.type === 'downstream_effect' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                                'bg-sky-500/20 text-sky-400 border-sky-500/30'
                              }`}>{item.type}</Badge>
                              <span className="text-sm font-medium font-mono">{item.code}</span>
                            </div>
                            {item.step && <p className="text-xs text-muted-foreground">Step: {item.step}</p>}
                            <pre className="text-[10px] mt-1 text-muted-foreground">
                              {JSON.stringify(item.evidence, null, 2)}
                            </pre>
                          </CardContent>
                        </Card>
                      ))}
                      {(!selectedReport.causal_chain || selectedReport.causal_chain.length === 0) && (
                        <p className="text-sm text-muted-foreground">Keine Kausalkette verfügbar</p>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="steps">
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-1">
                        {(selectedReport.impacted_steps || []).map((step: any, i: number) => (
                          <div key={i} className="flex items-center justify-between p-2 rounded bg-muted/20">
                            <span className="text-sm font-mono">{step.step_key}</span>
                            <Badge variant="outline" className={`text-[10px] ${
                              step.status === "done" ? "text-emerald-400" :
                              step.status === "skipped" ? "text-amber-400" :
                              step.status === "processing" ? "text-sky-400" :
                              "text-muted-foreground"
                            }`}>{step.status}</Badge>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="jobs">
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2">
                        {(selectedReport.impacted_jobs || []).map((job: any, i: number) => (
                          <Card key={i} className="border-border/30">
                            <CardContent className="p-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-mono">{job.job_type}</span>
                                <Badge variant="outline" className="text-[10px]">{job.status}</Badge>
                              </div>
                              {job.locked_by && <p className="text-[10px] text-muted-foreground mt-1">Runner: {job.locked_by}</p>}
                              {job.hours_stale > 0.5 && (
                                <p className="text-[10px] text-red-400 mt-1">
                                  <AlertTriangle className="h-3 w-3 inline mr-1" />
                                  Stale: {Number(job.hours_stale).toFixed(1)}h
                                </p>
                              )}
                              {job.last_error && (
                                <p className="text-[10px] text-muted-foreground mt-1 truncate">{String(job.last_error).slice(-80)}</p>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="actions">
                    <div className="space-y-3">
                      {(selectedReport.recommended_actions || []).map((action: any, i: number) => (
                        <Card key={i} className="border-border/30">
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between mb-1">
                              <Badge variant="outline" className="text-[10px]">{action.action_code}</Badge>
                              <Badge variant={action.auto_allowed ? "default" : "secondary"} className="text-[10px]">
                                {action.auto_allowed ? "✓ Auto OK" : "✗ Manual"}
                              </Badge>
                            </div>
                            <p className="text-sm">{action.description}</p>
                            {action.why && <p className="text-xs text-muted-foreground mt-1">Grund: {action.why}</p>}
                            <p className="text-[10px] text-muted-foreground mt-1">Safety: {action.safety_level}</p>
                          </CardContent>
                        </Card>
                      ))}
                      {(!selectedReport.recommended_actions || selectedReport.recommended_actions.length === 0) && (
                        <p className="text-sm text-muted-foreground">Keine Empfehlungen</p>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card className="flex items-center justify-center h-[400px]">
              <p className="text-muted-foreground">Report auswählen für Details</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/20 rounded p-3">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm font-medium mt-1">{value}</p>
    </div>
  );
}
