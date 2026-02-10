import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck, AlertTriangle, XCircle, CheckCircle2,
  Brain, Eye, BarChart3, RefreshCw, Filter,
} from "lucide-react";

type ValidationDecision = "approve" | "revise" | "reject";

function decisionBadge(decision: string) {
  switch (decision) {
    case "approve": return <Badge className="bg-green-500/10 text-green-600 border-green-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>;
    case "revise": return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30"><AlertTriangle className="h-3 w-3 mr-1" />Revise</Badge>;
    case "reject": return <Badge className="bg-red-500/10 text-red-600 border-red-500/30"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
    default: return <Badge variant="outline">{decision}</Badge>;
  }
}

function scoreColor(score: number): string {
  if (score >= 85) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

export default function ValidationDashboardPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch generations with their validations
  const { data: generations, isLoading } = useQuery({
    queryKey: ["admin-generations", statusFilter, entityFilter],
    queryFn: async () => {
      let query = supabase
        .from("ai_generations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (entityFilter !== "all") query = query.eq("entity_type", entityFilter);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch validations
  const { data: validations } = useQuery({
    queryKey: ["admin-validations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_validations")
        .select("*")
        .order("validated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  // Stats
  const stats = {
    total: generations?.length || 0,
    generated: generations?.filter(g => g.status === "generated").length || 0,
    validated: generations?.filter(g => g.status === "validated").length || 0,
    approved: generations?.filter(g => g.status === "approved").length || 0,
    rejected: generations?.filter(g => g.validation_decision === "reject").length || 0,
    avgScore: validations?.length
      ? Math.round(validations.reduce((s, v) => s + (v.overall_score || 0), 0) / validations.length)
      : 0,
  };

  // Manual approve action
  const approveMutation = useMutation({
    mutationFn: async (generationId: string) => {
      await supabase.from("ai_generations").update({ status: "approved" }).eq("id", generationId);
      await supabase.from("ai_quality_gates").insert({
        generation_id: generationId,
        gate_type: "manual_review",
        gate_status: "passed",
        decided_at: new Date().toISOString(),
        reason: "Manuell vom Admin freigegeben",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-generations"] });
      toast({ title: "Freigegeben", description: "Inhalt wurde manuell freigegeben." });
    },
  });

  // Manual reject action
  const rejectMutation = useMutation({
    mutationFn: async (generationId: string) => {
      await supabase.from("ai_generations").update({ status: "rejected", validation_decision: "reject" }).eq("id", generationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-generations"] });
      toast({ title: "Abgelehnt", description: "Inhalt wurde abgelehnt." });
    },
  });

  // Trigger manual re-validation
  const revalidateMutation = useMutation({
    mutationFn: async (gen: { id: string; entity_type: string; output_content: unknown; }) => {
      const { error } = await supabase.functions.invoke("validate-content", {
        body: {
          mode: gen.entity_type === "tutor_response" ? "tutor_response" : gen.entity_type === "question" ? "question" : "lesson",
          content: gen.output_content,
          generationId: gen.id,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-generations"] });
      queryClient.invalidateQueries({ queryKey: ["admin-validations"] });
      toast({ title: "Re-Validierung gestartet", description: "Opus prüft den Inhalt erneut." });
    },
    onError: (err) => {
      toast({ title: "Fehler", description: String(err), variant: "destructive" });
    },
  });

  return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              LLM Council – Validation Dashboard
            </h1>
            <p className="text-muted-foreground mt-1">
              GPT-5.2 Generator → Opus 4.6 Validator → Admin Quality Gate
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { label: "Generiert", value: stats.total, icon: Brain },
            { label: "Validiert", value: stats.validated, icon: Eye },
            { label: "Approved", value: stats.approved, icon: CheckCircle2 },
            { label: "Rejected", value: stats.rejected, icon: XCircle },
            { label: "Ø Score", value: stats.avgScore, icon: BarChart3 },
            { label: "Pending", value: stats.generated, icon: AlertTriangle },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2">
                  <s.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="generations">
          <TabsList>
            <TabsTrigger value="generations">Generierungen</TabsTrigger>
            <TabsTrigger value="validations">Validierungen</TabsTrigger>
            <TabsTrigger value="rules">Regeln</TabsTrigger>
          </TabsList>

          {/* Generations Tab */}
          <TabsContent value="generations" className="space-y-4">
            <div className="flex gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="generated">Generated</SelectItem>
                  <SelectItem value="validated">Validated</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Typ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Typen</SelectItem>
                  <SelectItem value="lesson">Lesson</SelectItem>
                  <SelectItem value="question">Question</SelectItem>
                  <SelectItem value="tutor_response">Tutor</SelectItem>
                  <SelectItem value="blog_article">Blog</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Typ</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead>Erstellt</TableHead>
                      <TableHead>Aktionen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-8">Laden...</TableCell></TableRow>
                    ) : generations?.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Keine Generierungen gefunden</TableCell></TableRow>
                    ) : (
                      generations?.map((gen) => (
                        <TableRow key={gen.id}>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{gen.entity_type}</Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono">{gen.generator_model?.split('/').pop()}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-xs">{gen.status}</Badge>
                          </TableCell>
                          <TableCell>
                            {gen.validation_score != null ? (
                              <span className={`font-mono font-bold ${scoreColor(gen.validation_score)}`}>
                                {gen.validation_score}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">–</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {gen.validation_decision ? decisionBadge(gen.validation_decision) : <span className="text-muted-foreground">Pending</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(gen.created_at).toLocaleDateString('de-DE')}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {gen.status === "validated" && (
                                <Button size="sm" variant="outline" className="h-7 text-xs"
                                  onClick={() => approveMutation.mutate(gen.id)}>
                                  <CheckCircle2 className="h-3 w-3 mr-1" />Approve
                                </Button>
                              )}
                              {gen.status !== "rejected" && gen.status !== "approved" && (
                                <Button size="sm" variant="ghost" className="h-7 text-xs"
                                  onClick={() => revalidateMutation.mutate(gen)}>
                                  <RefreshCw className="h-3 w-3 mr-1" />Re-Validate
                                </Button>
                              )}
                              {gen.status !== "rejected" && (
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                                  onClick={() => rejectMutation.mutate(gen.id)}>
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Validations Tab */}
          <TabsContent value="validations">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Validierungsberichte (Opus 4.6)</CardTitle>
                <CardDescription>Jede Validierung mit Dimension-Scores und Issues</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      <TableHead>Modus</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead>Issues</TableHead>
                      <TableHead>Latenz</TableHead>
                      <TableHead>Datum</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validations?.map((val) => {
                      const issues = (val.critical_issues as Array<{ severity: string }>) || [];
                      const criticalCount = issues.filter(i => i.severity === "critical").length;
                      return (
                        <TableRow key={val.id}>
                          <TableCell className="text-xs font-mono">{val.validator_model?.split('-').slice(0, 2).join('-')}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{val.validation_mode}</Badge></TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className={`font-mono font-bold ${scoreColor(val.overall_score)}`}>{val.overall_score}</span>
                              <Progress value={val.overall_score} className="w-16 h-1.5" />
                            </div>
                          </TableCell>
                          <TableCell>{decisionBadge(val.decision)}</TableCell>
                          <TableCell>
                            {criticalCount > 0 ? (
                              <Badge variant="destructive" className="text-xs">{criticalCount} critical</Badge>
                            ) : issues.length > 0 ? (
                              <span className="text-xs text-muted-foreground">{issues.length} issues</span>
                            ) : (
                              <span className="text-xs text-green-600">Clean</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{val.latency_ms ? `${val.latency_ms}ms` : "–"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(val.validated_at).toLocaleDateString('de-DE')}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Rules Tab */}
          <TabsContent value="rules">
            <ValidationRulesTab />
          </TabsContent>
        </Tabs>
      </div>
    
  );
}

function ValidationRulesTab() {
  const { data: rules } = useQuery({
    queryKey: ["admin-validation-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_validation_rules")
        .select("*")
        .order("entity_type")
        .order("weight", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const grouped = (rules || []).reduce((acc, rule) => {
    const key = rule.entity_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(rule);
    return acc;
  }, {} as Record<string, typeof rules>);

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([entityType, entityRules]) => (
        <Card key={entityType}>
          <CardHeader>
            <CardTitle className="text-lg capitalize">{entityType}</CardTitle>
            <CardDescription>Validierungsregeln für {entityType}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Regel</TableHead>
                  <TableHead>Dimension</TableHead>
                  <TableHead>Gewicht</TableHead>
                  <TableHead>Min Score</TableHead>
                  <TableHead>Kritisch</TableHead>
                  <TableHead>Aktiv</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entityRules?.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{rule.rule_name.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-muted-foreground">{rule.rule_description}</p>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{rule.dimension}</Badge></TableCell>
                    <TableCell className="font-mono">{rule.weight}%</TableCell>
                    <TableCell className="font-mono">{rule.min_score}</TableCell>
                    <TableCell>{rule.is_critical ? <AlertTriangle className="h-4 w-4 text-red-500" /> : "–"}</TableCell>
                    <TableCell>{rule.is_active ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
