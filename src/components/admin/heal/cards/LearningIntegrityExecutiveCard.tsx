import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

type Summary = {
  published_total: number;
  green: number;
  yellow: number;
  red: number;
  avg_score: number;
  computed_at: string;
  top_gaps: Record<string, number>;
};

type AuditRow = {
  package_id: string;
  package_key: string;
  title: string;
  status: string;
  publish_learning_status: "green" | "yellow" | "red";
  learning_integrity_score: number;
  approved_exam_question_count: number;
  lesson_count: number;
  minicheck_count: number;
  oral_blueprint_count: number;
  tutor_context_count: number;
  competency_coverage_pct: number;
  blueprint_coverage_pct: number;
  duplicate_question_ratio: number;
};

const GAP_LABELS: Record<string, string> = {
  no_lessons: "Keine Lessons",
  no_minichecks: "Keine MiniChecks",
  low_exam_questions: "< 50 approved Exam Q",
  no_oral: "Kein Oral-Blueprint",
  no_tutor_context: "Kein Tutor-Context",
  low_competency_coverage: "Competency-Coverage < 80%",
  low_blueprint_coverage: "LF-Coverage < 80%",
  high_duplicates: "Duplikate > 15%",
};

function StatusDot({ status }: { status: "green" | "yellow" | "red" }) {
  const tone =
    status === "green"
      ? "bg-status-success-subtle text-status-success-foreground"
      : status === "yellow"
      ? "bg-status-warning-subtle text-status-warning-foreground"
      : "bg-status-error-subtle text-status-error-foreground";
  return <Badge className={`${tone} border-0 uppercase`}>{status}</Badge>;
}

export function LearningIntegrityExecutiveCard() {
  const summary = useQuery({
    queryKey: ["learning-integrity-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_learning_integrity_summary" as any,
      );
      if (error) throw error;
      return data as Summary;
    },
    refetchInterval: 60_000,
  });

  const audit = useQuery({
    queryKey: ["learning-integrity-audit", "red+yellow"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_learning_integrity_audit" as any,
        { _status_filter: null, _published_only: true },
      );
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
    refetchInterval: 60_000,
  });

  return (
    <Card className="shadow-elev-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Learning Integrity (LXI v1)
          <Badge variant="outline" className="text-xs">Dry-Run</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : summary.data ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Published" value={summary.data.published_total} />
              <Stat label="Green" value={summary.data.green} tone="success" />
              <Stat label="Yellow" value={summary.data.yellow} tone="warning" />
              <Stat label="Red" value={summary.data.red} tone="danger" />
            </div>
            <div className="text-sm text-text-muted">
              Avg Learning Integrity Score: <span className="text-text-strong font-medium">{summary.data.avg_score ?? 0}</span> / 100
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-text-muted mb-2">Gap Distribution</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(summary.data.top_gaps ?? {})
                  .filter(([, n]) => (n as number) > 0)
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .map(([k, n]) => (
                    <Badge key={k} variant="secondary" className="font-normal">
                      {GAP_LABELS[k] ?? k}: <span className="ml-1 font-semibold">{n as number}</span>
                    </Badge>
                  ))}
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-text-muted">Keine Daten.</div>
        )}

        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-2">
            Top Critical (Red zuerst, niedrigster Score)
          </div>
          {audit.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="rounded-md border border-border-subtle divide-y divide-border-subtle">
              {(audit.data ?? []).slice(0, 12).map((r) => (
                <div key={r.package_id} className="p-2 flex items-center gap-3 text-sm">
                  <StatusDot status={r.publish_learning_status} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-text-strong">{r.title}</div>
                    <div className="text-xs text-text-muted truncate">{r.package_key}</div>
                  </div>
                  <div className="text-right text-xs text-text-muted shrink-0">
                    <div>Score <span className="text-text-strong font-medium">{r.learning_integrity_score}</span></div>
                    <div>EQ {r.approved_exam_question_count} · L {r.lesson_count} · MC {r.minicheck_count} · O {r.oral_blueprint_count} · T {r.tutor_context_count}</div>
                  </div>
                </div>
              ))}
              {(audit.data?.length ?? 0) === 0 && (
                <div className="p-3 text-sm text-text-muted">Keine Befunde.</div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "danger";
}) {
  const cls =
    tone === "success"
      ? "text-status-success-foreground"
      : tone === "warning"
      ? "text-status-warning-foreground"
      : tone === "danger"
      ? "text-status-error-foreground"
      : "text-text-strong";
  return (
    <div className="rounded-md border border-border-subtle p-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className={`text-2xl font-semibold ${cls}`}>{value ?? 0}</div>
    </div>
  );
}
