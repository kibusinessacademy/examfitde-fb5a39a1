import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, Users, AlertTriangle, CheckCircle2, FileSearch } from "lucide-react";
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

export default function SyntheticCohortPage() {
  const qc = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

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
    value >= 80 ? "text-status-success" : value >= 60 ? "text-status-warn" : "text-status-danger";
  return <span className={tone}>{value.toFixed(0)}</span>;
}

function SeverityBadge({ severity }: { severity: "info" | "warn" | "critical" }) {
  if (severity === "critical") return <Badge variant="destructive">critical</Badge>;
  if (severity === "warn")
    return <Badge variant="outline" className="border-status-warn text-status-warn">warn</Badge>;
  return <Badge variant="secondary">info</Badge>;
}
