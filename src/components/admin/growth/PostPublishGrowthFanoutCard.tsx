/**
 * PostPublishGrowthFanoutCard — Welle 2 Loop 2 Stabilisierung
 * Reviewt auto_heal_log + job_queue für die 6 Post-Publish Growth Job-Types.
 * Per Paket + per job_type Filter, Drilldown auf einzelne Logs.
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText, RefreshCw, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

const JOB_TYPES = [
  "seo_indexnow_submit",
  "package_post_publish_blog",
  "package_distribution_plan",
  "package_campaign_assets_generate",
  "package_email_sequence_enroll",
  "package_og_image_generate",
] as const;

type JobType = typeof JOB_TYPES[number];

function statusBadge(status: string) {
  if (status === "completed" || status === "success")
    return <Badge className="bg-emerald-500/15 text-emerald-700 text-[10px]">{status}</Badge>;
  if (status === "noop" || status === "skipped")
    return <Badge variant="secondary" className="text-[10px]">{status}</Badge>;
  if (status === "failed")
    return <Badge variant="destructive" className="text-[10px]">{status}</Badge>;
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

export default function PostPublishGrowthFanoutCard() {
  const [pkgId, setPkgId] = useState("");
  const [jobType, setJobType] = useState<"" | JobType>("");
  const [windowH, setWindowH] = useState(24);

  const summary = useQuery({
    queryKey: ["pp-growth-fanout-summary", windowH],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_get_post_publish_growth_fanout" as any,
        { p_window_hours: windowH } as any,
      );
      if (error) throw error;
      return data as any;
    },
    refetchInterval: 60_000,
  });

  const log = useQuery({
    queryKey: ["pp-growth-fanout-log", pkgId, jobType],
    queryFn: async () => {
      const isUuid = /^[0-9a-f-]{36}$/i.test(pkgId.trim());
      const { data, error } = await supabase.rpc(
        "admin_get_post_publish_growth_log" as any,
        {
          p_package_id: isUuid ? pkgId.trim() : null,
          p_job_type: jobType || null,
          p_limit: 100,
        } as any,
      );
      if (error) throw error;
      return data as any;
    },
    refetchInterval: 60_000,
  });

  const matrix = useMemo(() => {
    const buckets = summary.data?.summary_by_type_status ?? [];
    const map = new Map<string, Record<string, number>>();
    for (const row of buckets as any[]) {
      const k = row.job_type;
      if (!map.has(k)) map.set(k, {});
      map.get(k)![row.status] = row.count;
    }
    return JOB_TYPES.map((t) => ({ job_type: t, ...(map.get(t) ?? {}) }));
  }, [summary.data]);

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <ScrollText className="h-4 w-4" />
          Post-Publish Growth Fanout
          <Badge variant="outline" className="text-[10px]">window {windowH}h</Badge>
        </CardTitle>
        <div className="flex items-center gap-1">
          {[24, 72, 168].map((h) => (
            <Button
              key={h}
              size="sm"
              variant={windowH === h ? "default" : "outline"}
              className="text-[10px] h-6 px-2"
              onClick={() => setWindowH(h)}
            >
              {h}h
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => { summary.refetch(); log.refetch(); }}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        {/* Matrix */}
        <section>
          <div className="font-semibold mb-1">Outcome-Matrix (job_queue)</div>
          {summary.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-1 pr-2">job_type</th>
                    <th className="py-1 px-2 text-right">completed</th>
                    <th className="py-1 px-2 text-right">failed</th>
                    <th className="py-1 px-2 text-right">pending</th>
                    <th className="py-1 px-2 text-right">processing</th>
                    <th className="py-1 px-2 text-right">cancelled</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row) => (
                    <tr key={row.job_type} className="border-b last:border-0">
                      <td className="py-1 pr-2 font-mono">{row.job_type}</td>
                      <td className="py-1 px-2 text-right">{(row as any).completed ?? 0}</td>
                      <td className="py-1 px-2 text-right">
                        {((row as any).failed ?? 0) > 0
                          ? <span className="text-destructive font-semibold">{(row as any).failed}</span>
                          : 0}
                      </td>
                      <td className="py-1 px-2 text-right">{(row as any).pending ?? 0}</td>
                      <td className="py-1 px-2 text-right">{(row as any).processing ?? 0}</td>
                      <td className="py-1 px-2 text-right">{(row as any).cancelled ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Filter */}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Filter className="h-3 w-3 text-muted-foreground" />
            <Input
              value={pkgId}
              onChange={(e) => setPkgId(e.target.value)}
              placeholder="Package-UUID (optional)"
              className="h-7 text-[11px] font-mono"
            />
            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value as any)}
              className="h-7 text-[11px] rounded border bg-background px-2"
            >
              <option value="">alle job_types</option>
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </section>

        {/* Per-Package */}
        <section>
          <div className="font-semibold mb-1">Per-Package ({summary.data?.per_package?.length ?? 0})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {(summary.data?.per_package ?? []).map((p: any) => (
              <button
                key={p.package_id}
                onClick={() => setPkgId(p.package_id)}
                className="w-full text-left border rounded p-2 bg-muted/30 hover:bg-muted/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{p.title ?? p.package_key ?? p.package_id}</span>
                  <div className="flex gap-1">
                    {p.completed > 0 && <Badge className="bg-emerald-500/15 text-emerald-700 text-[10px]">{p.completed}✓</Badge>}
                    {p.failed > 0 && <Badge variant="destructive" className="text-[10px]">{p.failed}✗</Badge>}
                    {p.open > 0 && <Badge variant="outline" className="text-[10px]">{p.open}…</Badge>}
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">{p.package_id}</div>
              </button>
            ))}
            {(summary.data?.per_package ?? []).length === 0 && !summary.isLoading && (
              <div className="text-muted-foreground italic">Kein Fanout im Fenster.</div>
            )}
          </div>
        </section>

        {/* Logs */}
        <section>
          <div className="font-semibold mb-1">
            auto_heal_log ({log.data?.log_entries?.length ?? 0})
            {pkgId && <Badge variant="outline" className="ml-2 text-[10px]">filter pkg</Badge>}
            {jobType && <Badge variant="outline" className="ml-1 text-[10px]">filter {jobType}</Badge>}
            {(pkgId || jobType) && (
              <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px] ml-1"
                      onClick={() => { setPkgId(""); setJobType(""); }}>
                clear
              </Button>
            )}
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {(log.data?.log_entries ?? []).map((l: any) => {
              const meta = l.metadata ?? {};
              return (
                <div key={l.id} className="border rounded p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] truncate">{l.action_type}</span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(l.created_at), { addSuffix: true, locale: de })}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {statusBadge(l.result_status ?? "?")}
                    {meta.outcome && <Badge variant="outline" className="text-[10px]">outcome:{meta.outcome}</Badge>}
                    {meta.reason && <Badge variant="outline" className="text-[10px]">reason:{meta.reason}</Badge>}
                  </div>
                  {l.target_id && (
                    <div className="text-[10px] text-muted-foreground font-mono mt-1">pkg:{l.target_id}</div>
                  )}
                  {meta.details && (
                    <pre className="text-[10px] mt-1 bg-muted/40 rounded p-1 overflow-x-auto">
                      {JSON.stringify(meta.details, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
            {(log.data?.log_entries ?? []).length === 0 && !log.isLoading && (
              <div className="text-muted-foreground italic">Keine Log-Einträge.</div>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
