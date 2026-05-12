import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ListChecks } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  job_id: string;
  package_id: string;
  package_key: string | null;
  package_title: string | null;
  package_status: string | null;
  track: string | null;
  job_status: string;
  attempts: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  last_error_short: string | null;
  error_bucket: string | null;
  coverage_pct: number | null;
  coverage_min_pct: number | null;
  coverage_gap_pp: number | null;
  bronze_locked: boolean;
};

const STATUS_TONE: Record<string, string> = {
  processing: "bg-info-bg-subtle text-info border-info/30",
  pending: "bg-warning-bg-subtle text-warning border-warning/30",
  queued: "bg-warning-bg-subtle text-warning border-warning/30",
  failed: "bg-destructive-bg-subtle text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  completed: "bg-success-bg-subtle text-success border-success/30",
};

const BUCKET_TONE: Record<string, string> = {
  COVERAGE_GAP: "bg-warning-bg-subtle text-warning border-warning/30",
  TRACK_GUARD: "bg-info-bg-subtle text-info border-info/30",
  PRICING_PRODUCT: "bg-destructive-bg-subtle text-destructive border-destructive/30",
  PUBLISH_ARTIFACT: "bg-destructive-bg-subtle text-destructive border-destructive/30",
  BRONZE_LOCK: "bg-warning-bg-subtle text-warning border-warning/30",
  PARKED_PREREQ: "bg-muted text-muted-foreground border-border",
  NOOP_LOOP: "bg-muted text-muted-foreground border-border",
  OTHER: "bg-muted text-muted-foreground border-border",
};

export function AutoPublishErrorOverviewCard() {
  const [filter, setFilter] = useState("");
  const [bucket, setBucket] = useState<string>("ALL");
  const [onlyProblems, setOnlyProblems] = useState<string>("problems");

  const { data, isLoading } = useQuery({
    queryKey: ["admin_get_auto_publish_error_overview", onlyProblems],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_auto_publish_error_overview", {
        p_only_problems: onlyProblems === "problems",
      } as never);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 30_000,
  });

  const rows = useMemo(() => {
    let r = data ?? [];
    if (bucket !== "ALL") r = r.filter((x) => (x.error_bucket ?? "OTHER") === bucket);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      r = r.filter(
        (x) =>
          (x.package_key ?? "").toLowerCase().includes(f) ||
          (x.package_title ?? "").toLowerCase().includes(f) ||
          x.package_id.toLowerCase().includes(f),
      );
    }
    return r;
  }, [data, bucket, filter]);

  const buckets = useMemo(() => {
    const m = new Map<string, number>();
    (data ?? []).forEach((r) => {
      const k = r.error_bucket ?? "OTHER";
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ListChecks className="h-4 w-4 text-primary" />
          Auto-Publish Error Overview
          <Badge variant="outline" className="ml-2 text-[10px]">
            {rows.length} jobs
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Filter package…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 max-w-xs"
          />
          <Select value={bucket} onValueChange={setBucket}>
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Alle Buckets</SelectItem>
              {buckets.map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {k} ({v})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={onlyProblems} onValueChange={setOnlyProblems}>
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="problems">Nur Probleme</SelectItem>
              <SelectItem value="all">Inkl. completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <div className="text-xs text-muted-foreground p-4 text-center">Keine Auto-Publish-Jobs in den letzten 7 Tagen.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b">
                <tr className="text-left">
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Bucket</th>
                  <th className="py-2 pr-2">Paket</th>
                  <th className="py-2 pr-2">Track</th>
                  <th className="py-2 pr-2 text-right">Coverage</th>
                  <th className="py-2 pr-2 text-right">Gap</th>
                  <th className="py-2 pr-2 text-right">Att.</th>
                  <th className="py-2 pr-2">Updated</th>
                  <th className="py-2 pr-2">Last error</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.job_id} className="border-b border-border/50 hover:bg-muted/40">
                    <td className="py-1.5 pr-2">
                      <Badge variant="outline" className={`text-[10px] ${STATUS_TONE[r.job_status] ?? ""}`}>
                        {r.job_status}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-2">
                      {r.error_bucket ? (
                        <Badge variant="outline" className={`text-[10px] ${BUCKET_TONE[r.error_bucket] ?? ""}`}>
                          {r.error_bucket}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="font-mono text-[10px] text-muted-foreground">{r.package_key ?? r.package_id.slice(0, 8)}</div>
                      <div className="truncate max-w-[220px]">{r.package_title ?? "—"}</div>
                      {r.bronze_locked && (
                        <Badge variant="outline" className="text-[9px] mt-0.5 bg-warning-bg-subtle text-warning">
                          bronze
                        </Badge>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-[10px]">{r.track ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.coverage_pct != null ? `${r.coverage_pct}%` : "—"}
                      <span className="text-muted-foreground"> / {r.coverage_min_pct ?? "—"}%</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.coverage_gap_pp != null && r.coverage_gap_pp > 0 ? (
                        <span className="text-warning">−{r.coverage_gap_pp}pp</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.attempts}/{r.max_attempts}
                    </td>
                    <td className="py-1.5 pr-2 text-[10px] text-muted-foreground">
                      {new Date(r.updated_at).toLocaleString("de-DE", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                    </td>
                    <td className="py-1.5 pr-2 max-w-[260px] truncate text-[10px] text-muted-foreground" title={r.last_error_short ?? ""}>
                      {r.last_error_short ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
