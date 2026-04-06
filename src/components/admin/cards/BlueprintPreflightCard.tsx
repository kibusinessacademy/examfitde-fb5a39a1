import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface PreflightSummary {
  curriculum_id: string;
  total_blueprints: number;
  eligible: number;
  blocked: number;
  with_warnings: number;
  eligibility_pct: number;
}

const BLOCKER_LABELS: Record<string, string> = {
  not_approved: "Nicht genehmigt",
  missing_competency: "Kompetenz fehlt",
  missing_learning_field: "Lernfeld fehlt",
  missing_cognitive_level: "Bloom-Level fehlt",
  missing_knowledge_type: "Wissenstyp fehlt",
  empty_canonical_statement: "Kernaussage leer/zu kurz",
  empty_question_template: "Fragenvorlage leer/zu kurz",
  zero_exam_relevance: "Prüfungsrelevanz = 0",
};

const WARNING_LABELS: Record<string, string> = {
  missing_trap_definition: "Keine Trap-Definition",
  missing_expected_trap_type: "Kein expected_trap_type",
  missing_typical_errors: "Keine typischen Fehler",
  missing_rubric: "Kein Rubric",
  missing_variation_modes: "Keine Variationsmodi",
  low_exam_relevance: "Niedrige Prüfungsrelevanz",
  isolated_knowledge_only: "Nur isoliertes Wissen",
};

export default function BlueprintPreflightCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["blueprint-preflight-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_blueprint_preflight_summary" as any)
        .select("*")
        .order("blocked", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as unknown as PreflightSummary[];
    },
    staleTime: 60_000,
  });

  const { data: blockedDetails } = useQuery({
    queryKey: ["blueprint-preflight-blocked-details"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_blueprint_preflight_status" as any)
        .select("id, curriculum_id, name, hard_blockers, soft_warnings, blocker_count, warning_count")
        .eq("eligible", false)
        .order("blocker_count", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 60_000,
  });

  const totalAll = data?.reduce((s, r) => s + r.total_blueprints, 0) ?? 0;
  const eligibleAll = data?.reduce((s, r) => s + r.eligible, 0) ?? 0;
  const blockedAll = data?.reduce((s, r) => s + r.blocked, 0) ?? 0;
  const pct = totalAll > 0 ? Math.round((eligibleAll / totalAll) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-5 w-5 text-primary" />
          Blueprint Pre-Flight Gate
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Lade…</p>
        ) : (
          <>
            {/* Global summary */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold">{eligibleAll}</p>
                <p className="text-xs text-muted-foreground">Eligible</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-destructive">{blockedAll}</p>
                <p className="text-xs text-muted-foreground">Blockiert</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{pct}%</p>
                <p className="text-xs text-muted-foreground">Fan-out-Rate</p>
              </div>
            </div>

            <Progress value={pct} className="h-2" />

            {/* Per-curriculum breakdown */}
            {data && data.length > 0 && (
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="curricula">
                  <AccordionTrigger className="text-sm">
                    {data.length} Curricula mit Blueprints
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {data.map((row) => (
                        <div key={row.curriculum_id} className="flex items-center justify-between text-xs border-b pb-1">
                          <span className="font-mono truncate max-w-[140px]" title={row.curriculum_id}>
                            {row.curriculum_id.slice(0, 8)}…
                          </span>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1 text-green-600" />
                              {row.eligible}
                            </Badge>
                            {row.blocked > 0 && (
                              <Badge variant="destructive" className="text-xs">
                                <XCircle className="h-3 w-3 mr-1" />
                                {row.blocked}
                              </Badge>
                            )}
                            {row.with_warnings > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                {row.with_warnings}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            {/* Blocked details */}
            {blockedDetails && blockedDetails.length > 0 && (
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="blocked">
                  <AccordionTrigger className="text-sm text-destructive">
                    {blockedDetails.length} blockierte Blueprints (Details)
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {blockedDetails.slice(0, 20).map((bp) => (
                        <div key={bp.id} className="text-xs border rounded p-2 space-y-1">
                          <div className="font-medium truncate" title={bp.name}>
                            {bp.name || bp.id.slice(0, 8)}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {(bp.hard_blockers || []).map((b: string) => (
                              <Badge key={b} variant="destructive" className="text-[10px]">
                                {BLOCKER_LABELS[b] || b}
                              </Badge>
                            ))}
                            {(bp.soft_warnings || []).map((w: string) => (
                              <Badge key={w} variant="secondary" className="text-[10px]">
                                {WARNING_LABELS[w] || w}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
