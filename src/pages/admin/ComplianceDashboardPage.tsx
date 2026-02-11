import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, ShieldAlert, ShieldCheck, ScanLine, FileText, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-orange-500/20 text-orange-700 dark:text-orange-400",
  medium: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
  low: "bg-muted text-muted-foreground",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-destructive/20 text-destructive",
  in_progress: "bg-blue-500/20 text-blue-700 dark:text-blue-400",
  resolved: "bg-green-500/20 text-green-700 dark:text-green-400",
  accepted_risk: "bg-muted text-muted-foreground",
};

const AREA_LABELS: Record<string, string> = {
  pii: "PII / Datenschutz",
  rls: "RLS / Zugriffskontrolle",
  retention: "Datensparsamkeit",
  ai_act: "EU AI Act",
  azav_iso: "AZAV / ISO",
  exports: "Daten-Exports",
};

export default function ComplianceDashboardPage() {
  const qc = useQueryClient();
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const { data: findings, isLoading: loadingFindings } = useQuery({
    queryKey: ["compliance-findings", areaFilter, severityFilter],
    queryFn: async () => {
      let q = supabase
        .from("compliance_findings")
        .select("*")
        .order("severity" as never)
        .order("created_at", { ascending: false });

      if (areaFilter !== "all") q = q.eq("area", areaFilter as never);
      if (severityFilter !== "all") q = q.eq("severity", severityFilter as never);

      const { data, error } = await q.limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: reports, isLoading: loadingReports } = useQuery({
    queryKey: ["compliance-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const scanMutation = useMutation({
    mutationFn: async (scanType: string) => {
      const { data, error } = await supabase.functions.invoke("compliance-council-scan", {
        body: { scanType },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Scan abgeschlossen: ${data?.summary?.total_findings ?? 0} Findings`);
      qc.invalidateQueries({ queryKey: ["compliance-findings"] });
      qc.invalidateQueries({ queryKey: ["compliance-reports"] });
    },
    onError: (err) => toast.error(`Scan fehlgeschlagen: ${err.message}`),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("compliance_findings")
        .update({ status } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status aktualisiert");
      qc.invalidateQueries({ queryKey: ["compliance-findings"] });
    },
  });

  const openCritical = findings?.filter(f => f.severity === "critical" && f.status === "open").length ?? 0;
  const openHigh = findings?.filter(f => f.severity === "high" && f.status === "open").length ?? 0;
  const resolved = findings?.filter(f => f.status === "resolved").length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Shield className="h-5 w-5" /> Council 6: Compliance & Data Protection
          </h2>
          <p className="text-sm text-muted-foreground">DSGVO · EU AI Act · AZAV/ISO · Governance</p>
        </div>
        <Button
          onClick={() => scanMutation.mutate("full")}
          disabled={scanMutation.isPending}
          size="sm"
        >
          {scanMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ScanLine className="h-4 w-4 mr-1" />}
          Compliance Scan
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <ShieldAlert className="h-5 w-5 mx-auto text-destructive mb-1" />
            <div className="text-2xl font-bold text-destructive">{openCritical}</div>
            <div className="text-xs text-muted-foreground">Critical Open</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <AlertTriangle className="h-5 w-5 mx-auto text-orange-500 mb-1" />
            <div className="text-2xl font-bold">{openHigh}</div>
            <div className="text-xs text-muted-foreground">High Open</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <ShieldCheck className="h-5 w-5 mx-auto text-green-500 mb-1" />
            <div className="text-2xl font-bold">{resolved}</div>
            <div className="text-xs text-muted-foreground">Resolved</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <FileText className="h-5 w-5 mx-auto text-primary mb-1" />
            <div className="text-2xl font-bold">{reports?.length ?? 0}</div>
            <div className="text-xs text-muted-foreground">Reports</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="findings">
        <TabsList>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="space-y-4">
          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <Select value={areaFilter} onValueChange={setAreaFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Bereich" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Bereiche</SelectItem>
                {Object.entries(AREA_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loadingFindings ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !findings?.length ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              Keine Findings. Starte einen Compliance Scan.
            </CardContent></Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Bereich</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {findings.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>
                        <Badge className={SEVERITY_COLORS[f.severity] ?? ""}>{f.severity}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{AREA_LABELS[f.area] ?? f.area}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{f.title}</div>
                        <div className="text-xs text-muted-foreground line-clamp-1">{f.description}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLORS[f.status] ?? ""}>{f.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {f.status === "open" && (
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updateStatus.mutate({ id: f.id, status: "in_progress" })}
                            >
                              Start
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateStatus.mutate({ id: f.id, status: "accepted_risk" })}
                            >
                              Accept
                            </Button>
                          </div>
                        )}
                        {f.status === "in_progress" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus.mutate({ id: f.id, status: "resolved" })}
                          >
                            Resolve
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          {loadingReports ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !reports?.length ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              Keine Reports vorhanden.
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {reports.map((r) => {
                const summary = r.summary_json as Record<string, unknown> ?? {};
                return (
                  <Card key={r.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium">
                          {r.report_type.toUpperCase()} Report
                        </CardTitle>
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString("de-DE")}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="pb-3">
                      <div className="flex gap-4 text-xs">
                        <span>Findings: <strong>{String(summary.total_findings ?? 0)}</strong></span>
                        <span className="text-destructive">Critical: {String(summary.open_critical ?? 0)}</span>
                        <span className="text-orange-500">High: {String(summary.open_high ?? 0)}</span>
                        <span>Medium: {String(summary.open_medium ?? 0)}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
