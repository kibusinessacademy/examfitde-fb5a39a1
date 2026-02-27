import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface MatrixRow {
  col: string;
  curriculum_id: string | null;
  curriculum_title: string;
  q_total: number;
  q_approved: number;
  q_annotated: number;
  pct_annotated: number;
  elite_cnt: number;
  advanced_cnt: number;
  avg_score: number | null;
  multi_variable_cnt: number;
  transfer_cnt: number;
  pct_elite: number;
  pct_multivariable: number;
  pct_transfer: number;
  fresh_cnt: number;
  stale_cnt: number;
  missing_cnt: number;
  has_exam_pool: boolean;
  approved_coverage_100: boolean;
  elite_annotation_complete: boolean;
  minicheck_ready: boolean;
  lessons_cnt: number;
  oral_blueprints_cnt: number;
  oral_hardened_cnt: number;
  pct_oral_hardened: number;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? "default" : "destructive"} className="text-xs">
      {ok ? "✅" : "❌"} {label}
    </Badge>
  );
}

function MetricCell({ value, suffix = "" }: { value: number | string | null; suffix?: string }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return <span className="font-mono text-sm">{value}{suffix}</span>;
}

const METRICS: { label: string; render: (r?: MatrixRow) => React.ReactNode; systemLevel?: boolean }[] = [
  {
    label: "Exam-Pool",
    render: (r) => r ? <StatusBadge ok={r.has_exam_pool} label={`${r.q_approved} Fragen`} /> : null,
  },
  {
    label: "Approved Coverage",
    render: (r) => r ? <StatusBadge ok={r.approved_coverage_100} label={`${r.q_approved}/${r.q_total}`} /> : null,
  },
  {
    label: "Elite-Annotation",
    render: (r) => r ? <StatusBadge ok={r.elite_annotation_complete} label={`${r.q_annotated}/${r.q_approved}`} /> : null,
  },
  {
    label: "Ø Elite-Score",
    render: (r) => <MetricCell value={r?.avg_score ?? null} />,
  },
  {
    label: "% Elite",
    render: (r) => <MetricCell value={r?.pct_elite ?? null} suffix="%" />,
  },
  {
    label: "Multi-Variable",
    render: (r) => <MetricCell value={r?.pct_multivariable ?? null} suffix="%" />,
  },
  {
    label: "Transfer",
    render: (r) => <MetricCell value={r?.pct_transfer ?? null} suffix="%" />,
  },
  {
    label: "MiniCheck-Ready",
    render: (r) => r ? <StatusBadge ok={r.minicheck_ready} label={r.minicheck_ready ? "Ja" : "Nein"} /> : null,
  },
  {
    label: "Lessons",
    render: (r) => r ? <StatusBadge ok={r.lessons_cnt > 0} label={`${r.lessons_cnt}`} /> : null,
  },
  {
    label: "Oral gehärtet",
    render: (r) =>
      r ? (
        r.oral_blueprints_cnt > 0 ? (
          <MetricCell value={r.pct_oral_hardened} suffix={`% (${r.oral_hardened_cnt}/${r.oral_blueprints_cnt})`} />
        ) : (
          <span className="text-muted-foreground">❌ 0</span>
        )
      ) : null,
  },
  {
    label: "Freshness",
    render: (r) =>
      r ? (
        <span className="text-xs space-x-2">
          <span className="text-primary">{r.fresh_cnt} fresh</span>
          {r.stale_cnt > 0 && <span className="text-accent-foreground">{r.stale_cnt} stale</span>}
          {r.missing_cnt > 0 && <span className="text-destructive">{r.missing_cnt} missing</span>}
        </span>
      ) : null,
  },
  { label: "Lease/Lock System", render: () => <Badge variant="outline">✅ Global</Badge>, systemLevel: true },
  { label: "AI Budget Guard", render: () => <Badge variant="outline">✅ Global</Badge>, systemLevel: true },
  { label: "JSON-Validation", render: () => <Badge variant="outline">✅ Global</Badge>, systemLevel: true },
  { label: "Export Count Guard", render: () => <Badge variant="outline">✅ Global</Badge>, systemLevel: true },
];

export default function EliteMatrixPage() {
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke("admin-elite-matrix", {
          body: {},
        });
        if (!active) return;
        if (fnError) throw fnError;
        if (!data?.ok) throw new Error(data?.error || "Unknown error");
        setRows(data.rows ?? []);
      } catch (e: unknown) {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const byCol = useMemo(() => {
    const m = new Map<string, MatrixRow>();
    for (const r of rows) m.set(r.col, r);
    return m;
  }, [rows]);

  const columns = [
    { key: "MFA", row: byCol.get("MFA") },
    { key: "PKA", row: byCol.get("PKA") },
    { key: "Andere", row: byCol.get("Andere") },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Elite-Matrix</h1>
        <p className="text-sm text-muted-foreground">
          Echtdaten-Übersicht aller Qualitätsmetriken — MFA, PKA, weitere Kurse aggregiert
        </p>
      </div>

      {loading && (
        <Card>
          <CardContent className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="p-6">
            <p className="text-destructive font-medium">Fehler: {error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Qualitätsmatrix</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium text-muted-foreground min-w-[180px]">Bereich</th>
                    {columns.map((c) => (
                      <th key={c.key} className="text-left p-3 min-w-[200px]">
                        <span className="font-semibold">{c.key}</span>
                        {c.row && (
                          <span className="block text-xs font-normal text-muted-foreground truncate max-w-[200px]">
                            {c.row.curriculum_title}
                          </span>
                        )}
                      </th>
                    ))}
                    <th className="text-left p-3 font-medium text-muted-foreground min-w-[120px]">System</th>
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((m) => (
                    <tr key={m.label} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-medium">{m.label}</td>
                      {columns.map((c) => (
                        <td key={c.key} className="p-3">
                          {m.render(c.row)}
                        </td>
                      ))}
                      <td className="p-3 text-muted-foreground text-xs">
                        {m.systemLevel ? "Global" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
