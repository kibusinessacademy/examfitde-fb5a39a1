/**
 * ArtifactCompletenessCard — Per-Package Artefakt-Completeness-Check.
 * Eingabe: Komma-separierte Package-IDs. Zeigt sofort was fehlt (Lessons,
 * Exam, Handbook, Open Steps) pro Paket.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type GapItem = {
  priority: number; gap: string; count: number;
  severity: "critical" | "warn" | "info" | "ok";
  recommended_action: string;
  recommended_step: string | null;
  reason: string;
};
type NextAction = { action?: string; reason?: string } & Partial<GapItem>;
type PkgRow = {
  package_id: string;
  title: string;
  status: string;
  build_progress: number;
  lessons: { total: number; with_content: number; qc_approved: number; with_minicheck: number;
             missing_content: number; missing_qc: number; missing_minicheck: number };
  exam: { approved: number; total: number; target: number; missing: number };
  handbook: { sections_total: number; sections_filled: number; missing: number };
  steps: { total: number; done: number; open: Array<{ step_key: string; status: string }> };
  prioritized_gaps: GapItem[];
  next_action: NextAction;
};

export function ArtifactCompletenessCard() {
  const [input, setInput] = useState(
    "55edacdf-... , 12d32d4b-... , acecaa35-...",
  );
  const [data, setData] = useState<{ packages: PkgRow[]; generated_at: string } | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      const ids = input.split(/[\s,;\n]+/).map((s) => s.trim()).filter((s) =>
        /^[0-9a-f-]{36}$/i.test(s),
      );
      if (ids.length === 0) throw new Error("Keine gültigen UUIDs gefunden");
      const { data, error } = await supabase.rpc(
        "admin_get_artifact_completeness" as any,
        { p_package_ids: ids } as any,
      );
      if (error) throw error;
      return data as any;
    },
    onSuccess: (d) => {
      setData(d);
      toast.success(`${d.packages?.length ?? 0} Pakete analysiert`);
    },
    onError: (e: any) => toast.error(e.message ?? "Fehler"),
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4" />
          Artefakt-Completeness-Check
        </h3>
        <Badge variant="outline" className="text-[10px]">
          per Package · Live-Diff
        </Badge>
      </div>

      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Package-IDs (komma- oder zeilen-separiert)"
        className="text-xs font-mono mb-2"
        rows={3}
      />
      <Button
        size="sm"
        onClick={() => run.mutate()}
        disabled={run.isPending}
      >
        {run.isPending ? "Lade…" : "Check ausführen"}
      </Button>

      {run.isPending && <Skeleton className="h-32 w-full mt-3" />}

      {data?.packages?.map((p) => (
        <div key={p.package_id} className="mt-4 border rounded p-3 bg-muted/30">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="font-semibold text-sm">{p.title ?? p.package_id}</div>
              <div className="text-[11px] text-muted-foreground font-mono">
                {p.package_id.slice(0, 8)} · {p.status} · {p.build_progress}%
              </div>
            </div>
            {p.prioritized_gaps.length === 0 ? (
              <Badge className="bg-emerald-500/15 text-emerald-700">VOLLSTÄNDIG</Badge>
            ) : (
              <Badge variant="destructive">{p.prioritized_gaps.length} GAP(S)</Badge>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <Metric label="Lessons Content" v={`${p.lessons.with_content}/${p.lessons.total}`}
                    bad={p.lessons.missing_content > 0} />
            <Metric label="Lessons QC" v={`${p.lessons.qc_approved}/${p.lessons.with_content}`}
                    bad={p.lessons.missing_qc > 0} />
            <Metric label="MiniChecks" v={`${p.lessons.with_minicheck}/${p.lessons.with_content}`}
                    bad={p.lessons.missing_minicheck > 0} />
            <Metric label={`Exam (Ziel ${p.exam.target})`} v={`${p.exam.approved}`}
                    bad={p.exam.missing > 0} />
            <Metric label="Handbook" v={`${p.handbook.sections_filled}/${p.handbook.sections_total}`}
                    bad={p.handbook.missing > 0} />
            <Metric label="Steps Done" v={`${p.steps.done}/${p.steps.total}`}
                    bad={p.steps.open.length > 0} />
          </div>

          {p.next_action && p.next_action.action !== "none" && p.next_action.recommended_action && (
            <div className="mt-3 rounded border border-primary/30 bg-primary/5 p-2 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="bg-primary/15 text-primary text-[10px]">NÄCHSTE AKTION</Badge>
                <span className="font-mono text-[11px]">{p.next_action.recommended_action}</span>
                {p.next_action.recommended_step && (
                  <span className="text-muted-foreground font-mono text-[10px]">
                    → {p.next_action.recommended_step}
                  </span>
                )}
              </div>
              <div className="text-muted-foreground">{p.next_action.reason}</div>
            </div>
          )}

          {p.prioritized_gaps.length > 0 && (
            <div className="mt-2 text-xs">
              <div className="font-semibold mb-1">Priorisierte Gaps (Top→Bottom):</div>
              <ol className="space-y-1">
                {p.prioritized_gaps.map((g) => (
                  <li key={g.gap} className="flex items-center gap-2 border rounded p-1.5 bg-background">
                    <Badge variant="outline" className="text-[10px] w-6 justify-center">P{g.priority}</Badge>
                    <Badge
                      className={`text-[10px] ${
                        g.severity === "critical" ? "bg-destructive-bg-subtle text-destructive" :
                        g.severity === "warn" ? "bg-amber-500/15 text-amber-700" :
                        "bg-muted text-muted-foreground"
                      }`}
                    >{g.severity}</Badge>
                    <span className="flex-1 truncate">{g.gap}</span>
                    <span className="font-mono font-semibold">{g.count}</span>
                    <span className="text-[10px] font-mono text-muted-foreground hidden md:inline">
                      {g.recommended_step ?? g.recommended_action}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {p.steps.open.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                {p.steps.open.length} offene Steps
              </summary>
              <ul className="mt-1 ml-3 space-y-0.5 font-mono text-[11px]">
                {p.steps.open.map((s, i) => (
                  <li key={i}>{s.step_key} <span className="text-muted-foreground">({s.status})</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
    </Card>
  );
}

function Metric({ label, v, bad }: { label: string; v: string; bad?: boolean }) {
  return (
    <div className="rounded border p-1.5 bg-background">
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className={`font-mono font-semibold ${bad ? "text-destructive" : ""}`}>{v}</div>
    </div>
  );
}
