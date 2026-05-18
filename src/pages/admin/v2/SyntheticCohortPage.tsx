import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, Users, AlertTriangle, CheckCircle2, FileSearch, RotateCw, Bug, Sparkles } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface RunRow {
  id: string;
  status: string;
  mode: string;
  packages_total: number;
  packages_completed: number;
  packages_with_findings: number;
  total_findings: number;
  llm_calls: number;
  avg_didactic_score: number | null;
  started_at: string;
  completed_at: string | null;
}

interface Persona {
  id: string;
  persona_key: string;
  display_name: string;
  description: string | null;
  target_accuracy: number;
}

interface PackageRow {
  package_id: string;
  package_label: string | null;
  avg_didactic_score: number;
  avg_ihk_score: number;
  avg_question_score: number;
  flagged: boolean;
  findings_count: number;
  critical_count: number;
}

interface FindingRow {
  id: string;
  package_id: string;
  package_label: string | null;
  finding_type: string;
  severity: "info" | "warn" | "critical";
  detail: string;
  suggested_fix: string | null;
}

interface DebugRow {
  package_id: string;
  package_label: string | null;
  persona_key: string;
  total_lessons: number | null;
  total_questions: number | null;
  simulated_questions: number | null;
  correct_count: number | null;
  avg_response_ms: number | null;
  didactic_score: number | null;
  step_score: number | null;
  ihk_score: number | null;
  question_score: number | null;
  flagged_for_llm: boolean;
}

interface LlmCandidateRow {
  package_id: string;
  package_label: string | null;
  avg_didactic: number;
  avg_step: number;
  avg_ihk: number;
  avg_question: number;
  trigger_reason: string;
}

export default function SyntheticCohortPage() {
  const qc = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(true);

  const personasQ = useQuery({
    queryKey: ["synth-personas"],
    queryFn: async (): Promise<Persona[]> => {
      const { data, error } = await supabase
        .from("synth_personas")
        .select("id, persona_key, display_name, description, target_accuracy")
        .eq("active", true)
        .order("target_accuracy");
      if (error) throw error;
      return (data ?? []) as Persona[];
    },
  });

  const runsQ = useQuery({
    queryKey: ["synth-runs"],
    queryFn: async (): Promise<RunRow[]> => {
      const { data, error } = await supabase.rpc("synth_list_runs", { p_limit: 20 });
      if (error) throw error;
      return ((data as unknown) as RunRow[]) ?? [];
    },
    refetchInterval: 5000,
  });

  const summaryQ = useQuery({
    queryKey: ["synth-summary", selectedRun],
    queryFn: async () => {
      if (!selectedRun) return null;
      const { data, error } = await supabase.rpc("synth_get_run_summary", {
        p_run_id: selectedRun,
      });
      if (error) throw error;
      return (data as unknown) as {
        run: RunRow;
        packages: PackageRow[];
        top_findings: FindingRow[];
      };
    },
    enabled: !!selectedRun,
  });

  const startMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("synthetic-cohort-runner", {
        body: { mode: "heuristic_with_llm_gate", max_llm_calls: 10 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: { run_id?: string; packages_processed?: number; llm_calls?: number }) => {
      toast.success(
        `Run abgeschlossen: ${data.packages_processed ?? 0} Pakete, ${data.llm_calls ?? 0} LLM-Calls`
      );
      if (data.run_id) setSelectedRun(data.run_id);
      qc.invalidateQueries({ queryKey: ["synth-runs"] });
    },
    onError: (e: Error) => toast.error(`Run fehlgeschlagen: ${e.message}`),
  });

  // Re-Run Heuristik (nach Schema-Drift-Fix)
  const rerunMut = useMutation({
    mutationFn: async (vars: { runId: string; onlyFlagged: boolean }) => {
      const { data, error } = await supabase.rpc("synth_rerun_heuristic", {
        p_run_id: vars.runId,
        p_only_flagged: vars.onlyFlagged,
      });
      if (error) throw error;
      return data as { ok: boolean; rerun_packages?: number; avg_didactic_score?: number; total_findings?: number; error?: string };
    },
    onSuccess: (data) => {
      if (!data?.ok) { toast.error(`Re-Run abgebrochen: ${data?.error ?? "unknown"}`); return; }
      toast.success(`Re-Run: ${data.rerun_packages} Pakete · Ø ${data.avg_didactic_score?.toFixed(1) ?? "—"} · ${data.total_findings} Findings`);
      qc.invalidateQueries({ queryKey: ["synth-runs"] });
      qc.invalidateQueries({ queryKey: ["synth-summary", selectedRun] });
      qc.invalidateQueries({ queryKey: ["synth-debug", selectedRun] });
      qc.invalidateQueries({ queryKey: ["synth-llm-candidates", selectedRun] });
    },
    onError: (e: Error) => toast.error(`Re-Run fehlgeschlagen: ${e.message}`),
  });

  // Gezielter LLM-Review nur für niedrige-Score-Pakete
  const llmTriggerMut = useMutation({
    mutationFn: async (vars: { runId: string; packageIds: string[] }) => {
      const { data, error } = await supabase.functions.invoke("synthetic-cohort-runner", {
        body: {
          run_id: vars.runId,
          package_ids: vars.packageIds,
          mode: "heuristic_with_llm_gate",
          max_llm_calls: Math.min(vars.packageIds.length, 20),
        },
      });
      if (error) throw error;
      return data as { llm_calls?: number; packages_processed?: number };
    },
    onSuccess: (data) => {
      toast.success(`LLM-Review: ${data.packages_processed ?? 0} Pakete · ${data.llm_calls ?? 0} Calls`);
      qc.invalidateQueries({ queryKey: ["synth-summary", selectedRun] });
    },
    onError: (e: Error) => toast.error(`LLM-Trigger fehlgeschlagen: ${e.message}`),
  });

  // Debug-Tabelle (lazy)
  const debugQ = useQuery({
    queryKey: ["synth-debug", selectedRun],
    queryFn: async (): Promise<DebugRow[]> => {
      if (!selectedRun) return [];
      const { data, error } = await supabase.rpc("synth_get_debug_table", { p_run_id: selectedRun });
      if (error) throw error;
      return ((data as unknown) as DebugRow[]) ?? [];
    },
    enabled: !!selectedRun && debugMode,
  });

  // LLM-Kandidaten (niedrige Scores)
  const llmCandidatesQ = useQuery({
    queryKey: ["synth-llm-candidates", selectedRun],
    queryFn: async (): Promise<LlmCandidateRow[]> => {
      if (!selectedRun) return [];
      const { data, error } = await supabase.rpc("synth_get_llm_candidates", { p_run_id: selectedRun });
      if (error) throw error;
      return ((data as unknown) as LlmCandidateRow[]) ?? [];
    },
    enabled: !!selectedRun,
  });

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Synthetic Cohort Runner</h1>
          <p className="text-sm text-text-secondary mt-1">
            Interne Demo-Lerner durchlaufen alle published Pakete für didaktische Validierung —
            ohne echte Learner-Daten zu beeinflussen.
          </p>
        </div>
        <Button
          onClick={() => startMut.mutate()}
          disabled={startMut.isPending}
          size="lg"
          className="gap-2"
        >
          {startMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Vollständigen Run starten
        </Button>
      </div>

      {/* Personas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Aktive Demo-Personas
          </CardTitle>
          <CardDescription>
            7 Verhaltens-Profile decken Schwach/Mittel/Top, Speed-Runner, Abbrecher, Wiederholer, Perfektionist ab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {personasQ.data?.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-border-subtle bg-surface-raised p-3 text-sm"
              >
                <div className="font-medium text-text-primary">{p.display_name}</div>
                <div className="text-xs text-text-tertiary mt-0.5">{p.description}</div>
                <Badge variant="outline" className="mt-2 text-xs">
                  Target {(p.target_accuracy * 100).toFixed(0)}%
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Run-Historie */}
      <Card>
        <CardHeader>
          <CardTitle>Letzte Runs</CardTitle>
          <CardDescription>Klick auf einen Run zeigt Paket-Ranking und Findings.</CardDescription>
        </CardHeader>
        <CardContent>
          {runsQ.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : !runsQ.data || runsQ.data.length === 0 ? (
            <p className="text-sm text-text-tertiary">Noch keine Runs. Starte den ersten oben.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gestartet</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Pakete</TableHead>
                  <TableHead className="text-right">Findings</TableHead>
                  <TableHead className="text-right">LLM-Calls</TableHead>
                  <TableHead className="text-right">Avg Score</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runsQ.data.map((r) => (
                  <TableRow
                    key={r.id}
                    className={selectedRun === r.id ? "bg-surface-raised" : ""}
                  >
                    <TableCell className="text-xs text-text-secondary">
                      {new Date(r.started_at).toLocaleString("de-DE")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "completed" ? "default" : "outline"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.packages_completed}/{r.packages_total}
                    </TableCell>
                    <TableCell className="text-right">{r.total_findings}</TableCell>
                    <TableCell className="text-right">{r.llm_calls}</TableCell>
                    <TableCell className="text-right font-mono">
                      {r.avg_didactic_score?.toFixed(1) ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedRun(r.id)}>
                        <FileSearch className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail: Paket-Ranking + Findings */}
      {selectedRun && summaryQ.data && (
        <>
          {/* Aktionen: Re-Run, Debug-Toggle, LLM-Trigger */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCw className="h-5 w-5" /> Run-Aktionen
              </CardTitle>
              <CardDescription>
                Heuristik nach einem Fix wiederholen, Roh-Werte inspizieren oder gezielt LLM-Review starten.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch id="only-flagged" checked={onlyFlagged} onCheckedChange={setOnlyFlagged} />
                <Label htmlFor="only-flagged" className="text-sm">Nur geflaggte Pakete</Label>
              </div>
              <Button
                size="sm"
                variant="default"
                disabled={rerunMut.isPending}
                onClick={() => rerunMut.mutate({ runId: selectedRun, onlyFlagged })}
                className="gap-2"
              >
                {rerunMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                Heuristik erneut ausführen
              </Button>

              <div className="flex items-center gap-2 ml-2">
                <Switch id="debug-mode" checked={debugMode} onCheckedChange={setDebugMode} />
                <Label htmlFor="debug-mode" className="text-sm flex items-center gap-1">
                  <Bug className="h-3 w-3" /> Debug-Tabelle
                </Label>
              </div>

              <Button
                size="sm"
                variant="outline"
                disabled={llmTriggerMut.isPending || !llmCandidatesQ.data?.length}
                onClick={() => llmTriggerMut.mutate({
                  runId: selectedRun,
                  packageIds: (llmCandidatesQ.data ?? []).map(c => c.package_id),
                })}
                className="gap-2 ml-auto"
              >
                {llmTriggerMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                LLM-Review für {llmCandidatesQ.data?.length ?? 0} Kandidaten
              </Button>
            </CardContent>
          </Card>

          {/* LLM-Kandidaten (niedrige Scores) */}
          {llmCandidatesQ.data && llmCandidatesQ.data.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" /> LLM-Review-Kandidaten
                </CardTitle>
                <CardDescription>
                  Pakete mit niedrigen Scores (didactic&lt;70, step&lt;70, ihk&lt;60, question&lt;60). Werden gezielt vom LLM tiefer geprüft.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paket</TableHead>
                      <TableHead>Grund</TableHead>
                      <TableHead className="text-right">Didaktik</TableHead>
                      <TableHead className="text-right">Step</TableHead>
                      <TableHead className="text-right">IHK</TableHead>
                      <TableHead className="text-right">Frage-Pool</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {llmCandidatesQ.data.map(c => (
                      <TableRow key={c.package_id}>
                        <TableCell className="font-medium">{c.package_label ?? c.package_id.slice(0, 8)}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{c.trigger_reason}</Badge></TableCell>
                        <TableCell className="text-right font-mono"><ScorePill value={c.avg_didactic} /></TableCell>
                        <TableCell className="text-right font-mono"><ScorePill value={c.avg_step} /></TableCell>
                        <TableCell className="text-right font-mono"><ScorePill value={c.avg_ihk} /></TableCell>
                        <TableCell className="text-right font-mono"><ScorePill value={c.avg_question} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Debug-Tabelle */}
          {debugMode && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bug className="h-5 w-5" /> Debug — berechnete Roh-Werte pro Session
                </CardTitle>
                <CardDescription>
                  Hilft Schema-Drifts zu erkennen: erwartete Lesson-/Frage-Zahlen vs. simulierte Werte.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {debugQ.isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Paket</TableHead>
                        <TableHead>Persona</TableHead>
                        <TableHead className="text-right">Lessons</TableHead>
                        <TableHead className="text-right">Q (approved)</TableHead>
                        <TableHead className="text-right">Q sim.</TableHead>
                        <TableHead className="text-right">Correct</TableHead>
                        <TableHead className="text-right">RT ms</TableHead>
                        <TableHead className="text-right">Did</TableHead>
                        <TableHead className="text-right">Step</TableHead>
                        <TableHead className="text-right">IHK</TableHead>
                        <TableHead className="text-right">Q-Score</TableHead>
                        <TableHead>LLM</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(debugQ.data ?? []).map((d, i) => (
                        <TableRow key={`${d.package_id}-${d.persona_key}-${i}`}>
                          <TableCell className="font-medium text-xs">{d.package_label ?? d.package_id.slice(0, 8)}</TableCell>
                          <TableCell className="text-xs font-mono">{d.persona_key}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{d.total_lessons ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{d.total_questions ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{d.simulated_questions ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{d.correct_count ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{d.avg_response_ms ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs"><ScorePill value={d.didactic_score} /></TableCell>
                          <TableCell className="text-right font-mono text-xs"><ScorePill value={d.step_score} /></TableCell>
                          <TableCell className="text-right font-mono text-xs"><ScorePill value={d.ihk_score} /></TableCell>
                          <TableCell className="text-right font-mono text-xs"><ScorePill value={d.question_score} /></TableCell>
                          <TableCell>{d.flagged_for_llm && <Badge variant="outline" className="text-xs">LLM</Badge>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Paket-Ranking (schwächste zuerst)</CardTitle>
              <CardDescription>
                Sortiert nach didaktischem Score. Geflaggte Pakete wurden zusätzlich vom LLM
                reviewed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paket</TableHead>
                    <TableHead className="text-right">Didaktik</TableHead>
                    <TableHead className="text-right">IHK</TableHead>
                    <TableHead className="text-right">Frage-Pool</TableHead>
                    <TableHead className="text-right">Findings</TableHead>
                    <TableHead className="text-right">Critical</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryQ.data.packages?.map((p) => (
                    <TableRow key={p.package_id}>
                      <TableCell className="font-medium">{p.package_label ?? p.package_id.slice(0, 8)}</TableCell>
                      <TableCell className="text-right font-mono">
                        <ScorePill value={p.avg_didactic_score} />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <ScorePill value={p.avg_ihk_score} />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <ScorePill value={p.avg_question_score} />
                      </TableCell>
                      <TableCell className="text-right">{p.findings_count}</TableCell>
                      <TableCell className="text-right">
                        {p.critical_count > 0 ? (
                          <Badge variant="destructive">{p.critical_count}</Badge>
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-status-success inline" />
                        )}
                      </TableCell>
                      <TableCell>
                        {p.flagged && (
                          <Badge variant="outline" className="text-xs">LLM</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Top Findings
              </CardTitle>
              <CardDescription>
                Sortiert nach Schweregrad. Critical zuerst.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {summaryQ.data.top_findings?.map((f) => (
                <div
                  key={f.id}
                  className="rounded-lg border border-border-subtle p-3 text-sm space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={f.severity} />
                    <span className="text-xs font-mono text-text-tertiary">{f.finding_type}</span>
                    <span className="text-xs text-text-secondary ml-auto">
                      {f.package_label ?? f.package_id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="text-text-primary">{f.detail}</div>
                  {f.suggested_fix && (
                    <div className="text-xs text-text-secondary italic">→ {f.suggested_fix}</div>
                  )}
                </div>
              ))}
              {(!summaryQ.data.top_findings || summaryQ.data.top_findings.length === 0) && (
                <p className="text-sm text-text-tertiary">Keine Findings — alles sauber.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ScorePill({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-text-tertiary">—</span>;
  const tone =
    value >= 80 ? "text-status-success" : value >= 60 ? "text-status-warning" : "text-status-error";
  return <span className={tone}>{value.toFixed(0)}</span>;
}

function SeverityBadge({ severity }: { severity: "info" | "warn" | "critical" }) {
  if (severity === "critical") return <Badge variant="destructive">critical</Badge>;
  if (severity === "warn")
    return <Badge variant="outline" className="border-status-warning-border text-status-warning">warn</Badge>;
  return <Badge variant="secondary">info</Badge>;
}
