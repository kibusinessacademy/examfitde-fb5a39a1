import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, AlertTriangle, CheckCircle, Clock, Play, Loader2, FileCode, Server } from "lucide-react";
import { toast } from "sonner";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  medium: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
  low: "bg-muted text-muted-foreground",
};

const SCAN_ICONS: Record<string, typeof Shield> = {
  rls_audit: Shield,
  edge_function_audit: FileCode,
  queue_health: Server,
};

type TechFinding = {
  id: string;
  scan_type: string;
  severity: string;
  title: string;
  description: string | null;
  affected_entity: string | null;
  status: string;
  evidence: Record<string, unknown>;
  scanned_at: string;
};

type PatchPlan = {
  id: string;
  title: string;
  severity: string;
  affected_area: string;
  patches_json: unknown;
  proposer_model: string | null;
  validator_model: string | null;
  proposer_reasoning: string | null;
  validator_reasoning: string | null;
  status: string;
  created_at: string;
};

type Recommendation = {
  id: string;
  title: string;
  source: string;
  details: string | null;
  status: string;
  created_at: string;
};

export default function TechCouncilPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("findings");

  const { data: findings, isLoading: findingsLoading } = useQuery({
    queryKey: ["tech-council-findings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tech_council_findings")
        .select("id, scan_type, severity, title, description, affected_entity, status, evidence, scanned_at")
        .order("scanned_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as TechFinding[];
    },
  });

  const { data: patchPlans, isLoading: plansLoading } = useQuery({
    queryKey: ["tech-council-patches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_patch_plans")
        .select("id, title, severity, affected_area, patches_json, proposer_model, validator_model, proposer_reasoning, validator_reasoning, status, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as PatchPlan[];
    },
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ["tech-council-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("council_recommendations")
        .select("id, title, source, details, status, created_at")
        .eq("council_id", "tech")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Recommendation[];
    },
  });

  const runScan = useMutation({
    mutationFn: async (scanAction: string) => {
      const { data, error } = await supabase.functions.invoke("tech-council-run", {
        body: { action: scanAction },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Scan abgeschlossen: ${data?.findings_created || 0} Findings`);
      queryClient.invalidateQueries({ queryKey: ["tech-council-findings"] });
      queryClient.invalidateQueries({ queryKey: ["tech-council-history"] });
    },
    onError: (err: Error) => toast.error(`Scan fehlgeschlagen: ${err.message}`),
  });

  const proposePatch = useMutation({
    mutationFn: async (fId: string) => {
      const { data, error } = await supabase.functions.invoke("tech-council-run", {
        body: { action: "propose_patch", findingId: fId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Patch-Vorschlag erstellt");
      queryClient.invalidateQueries({ queryKey: ["tech-council-patches"] });
      queryClient.invalidateQueries({ queryKey: ["tech-council-findings"] });
    },
    onError: (err: Error) => toast.error(`Propose fehlgeschlagen: ${err.message}`),
  });

  const openFindings = findings?.filter(f => f.status === "open").length || 0;
  const criticalFindings = findings?.filter(f => f.severity === "critical" && f.status === "open").length || 0;
  const approvedPatches = patchPlans?.filter(p => p.status === "approved").length || 0;
  const proposedPatches = patchPlans?.filter(p => p.status === "proposed").length || 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <div><p className="text-2xl font-bold">{openFindings}</p><p className="text-xs text-muted-foreground">Offene Findings</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-2">
          <Shield className="h-4 w-4 text-destructive" />
          <div><p className="text-2xl font-bold">{criticalFindings}</p><p className="text-xs text-muted-foreground">Kritisch</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <div><p className="text-2xl font-bold">{approvedPatches}</p><p className="text-xs text-muted-foreground">Approved</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-yellow-500" />
          <div><p className="text-2xl font-bold">{proposedPatches}</p><p className="text-xs text-muted-foreground">Wartend</p></div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Scans ausführen</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              { action: "scan_rls", label: "RLS Audit", icon: Shield },
              { action: "scan_edge", label: "Edge Functions", icon: FileCode },
              { action: "scan_queue", label: "Queue Health", icon: Server },
            ].map(({ action, label, icon: Icon }) => (
              <Button key={action} variant="outline" size="sm" onClick={() => runScan.mutate(action)} disabled={runScan.isPending}>
                {runScan.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Icon className="h-3 w-3 mr-1" />}
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="findings">Findings ({openFindings})</TabsTrigger>
          <TabsTrigger value="patches">Patches ({patchPlans?.length || 0})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="space-y-2 mt-3">
          {findingsLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div> :
           !findings?.length ? <p className="text-sm text-muted-foreground py-4 text-center">Keine Findings. Starte einen Scan.</p> :
           findings.map(f => {
             const Icon = SCAN_ICONS[f.scan_type] || Shield;
             return (
               <Card key={f.id} className="hover:shadow-sm transition-shadow">
                 <CardContent className="p-3 flex items-start gap-3">
                   <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                   <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2 flex-wrap">
                       <span className="font-medium text-sm">{f.title}</span>
                       <Badge className={SEVERITY_COLORS[f.severity] || ""} variant="secondary">{f.severity}</Badge>
                       <Badge variant="outline" className="text-xs">{f.status}</Badge>
                     </div>
                     {f.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{f.description}</p>}
                     {f.affected_entity && <p className="text-xs text-muted-foreground mt-0.5">→ {f.affected_entity}</p>}
                   </div>
                   {f.status === "open" && (
                     <Button size="sm" variant="ghost" onClick={() => proposePatch.mutate(f.id)} disabled={proposePatch.isPending}>
                       {proposePatch.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                     </Button>
                   )}
                 </CardContent>
               </Card>
             );
           })}
        </TabsContent>

        <TabsContent value="patches" className="space-y-2 mt-3">
          {plansLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div> :
           !patchPlans?.length ? <p className="text-sm text-muted-foreground py-4 text-center">Keine Patch Plans.</p> :
           patchPlans.map(p => (
             <Card key={p.id}>
               <CardContent className="p-3">
                 <div className="flex items-center gap-2 flex-wrap">
                   <span className="font-medium text-sm">{p.title}</span>
                   <Badge className={SEVERITY_COLORS[p.severity]} variant="secondary">{p.severity}</Badge>
                   <Badge variant={p.status === "approved" ? "default" : p.status === "rejected" ? "destructive" : "outline"}>{p.status}</Badge>
                   <Badge variant="outline" className="text-xs">{p.affected_area}</Badge>
                 </div>
                 <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                   <div>Proposer: <span className="text-foreground">{p.proposer_model || "—"}</span></div>
                   <div>Validator: <span className="text-foreground">{p.validator_model || "—"}</span></div>
                 </div>
                 {p.proposer_reasoning && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{p.proposer_reasoning}</p>}
                 {p.validator_reasoning && <p className="text-xs mt-1 line-clamp-2"><span className="text-muted-foreground">Validator:</span> {p.validator_reasoning}</p>}
                 {Array.isArray(p.patches_json) && (p.patches_json as unknown[]).length > 0 && (
                   <div className="mt-2 bg-muted/50 rounded p-2 text-xs font-mono max-h-32 overflow-auto">
                     {(p.patches_json as Array<{type: string; description: string}>).map((patch, i) => (
                       <div key={i} className="mb-1"><span className="text-primary">[{patch.type}]</span> {patch.description}</div>
                     ))}
                   </div>
                 )}
               </CardContent>
             </Card>
           ))}
        </TabsContent>

        <TabsContent value="history" className="space-y-2 mt-3">
          {historyLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div> :
           !history?.length ? <p className="text-sm text-muted-foreground py-4 text-center">Keine History.</p> :
           history.map(m => (
             <Card key={m.id}>
               <CardContent className="p-3">
                 <div className="flex items-center gap-2 text-xs">
                   <Badge variant="outline">{m.source}</Badge>
                   <span className="font-medium text-sm">{m.title}</span>
                   <Badge variant="secondary">{m.status}</Badge>
                   <span className="ml-auto text-muted-foreground">
                     {new Date(m.created_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                   </span>
                 </div>
                 {m.details && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.details}</p>}
               </CardContent>
             </Card>
           ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
