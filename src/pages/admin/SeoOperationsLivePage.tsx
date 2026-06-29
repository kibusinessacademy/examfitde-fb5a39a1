import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, Play, AlertTriangle, CheckCircle2, Clock, Globe2, FileBox, Search } from "lucide-react";

type LogRow = {
  id: string;
  action_type: string;
  result_status: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
};

type FlowKey = "seo_sitemap_warmup" | "indexnow_drain_pending" | "indexnow_backfill_sitemap" | "seo_internal_linker_run";

const FLOWS: { key: FlowKey; label: string; icon: any; trigger: () => Promise<unknown>; description: string }[] = [
  {
    key: "seo_sitemap_warmup",
    label: "Sitemap-Generierung & Warmup",
    icon: FileBox,
    description: "Pingt Suchmaschinen + wärmt Sub-Sitemap-Routen vor.",
    trigger: () => supabase.functions.invoke("seo-sitemap-warmup", { body: {} }),
  },
  {
    key: "indexnow_drain_pending",
    label: "IndexNow Drain (pending)",
    icon: Globe2,
    description: "Sendet pending Submissions in Chunks an IndexNow (Bing/Yandex).",
    trigger: () => supabase.functions.invoke("seo-submit-indexnow", { body: { action: "drain_pending", limit: 200, chunk_size: 50 } }),
  },
  {
    key: "indexnow_backfill_sitemap",
    label: "IndexNow Backfill aus Sitemap",
    icon: Search,
    description: "Enqueued alle Sitemap-URLs als pending (idempotent).",
    trigger: () => supabase.functions.invoke("seo-submit-indexnow", { body: { action: "backfill_sitemap" } }),
  },
  {
    key: "seo_internal_linker_run",
    label: "GSC-Sync / interner Linker (Batch)",
    icon: RefreshCw,
    description: "Re-baut den internen Linkgraphen anhand der Backlink-Regeln.",
    trigger: () => supabase.functions.invoke("seo-internal-linker", { body: { mode: "batch" } }),
  },
];

function statusBadge(status: string | null) {
  const s = (status ?? "").toLowerCase();
  if (s === "success" || s === "ok") return <Badge className="bg-green-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" />ok</Badge>;
  if (s === "partial") return <Badge className="bg-amber-500 text-white"><AlertTriangle className="h-3 w-3 mr-1" />partial</Badge>;
  if (s === "failed") return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />failed</Badge>;
  return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />{s || "unknown"}</Badge>;
}

export default function SeoOperationsLivePage() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<FlowKey | null>(null);

  const { data: events, isFetching, refetch } = useQuery({
    queryKey: ["seo-ops-live"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auto_heal_log")
        .select("id, action_type, result_status, created_at, payload")
        .in("action_type", FLOWS.map((f) => f.key))
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as LogRow[];
    },
    refetchInterval: 20_000,
  });

  const latestByFlow = new Map<string, LogRow>();
  for (const ev of events ?? []) {
    if (!latestByFlow.has(ev.action_type)) latestByFlow.set(ev.action_type, ev);
  }

  async function run(flow: typeof FLOWS[number]) {
    setBusy(flow.key);
    try {
      const res: any = await flow.trigger();
      if (res?.error) throw new Error(res.error.message ?? "Edge function failed");
      toast.success(`${flow.label} ausgelöst`);
      await new Promise((r) => setTimeout(r, 1200));
      await qc.invalidateQueries({ queryKey: ["seo-ops-live"] });
    } catch (e: any) {
      toast.error(`${flow.label} fehlgeschlagen`, { description: e?.message ?? String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">SEO Operations — Live-Status</h1>
          <p className="text-muted-foreground">
            Sitemap-Generierung, IndexNow-Submission, GSC/Linker-Sync. Auto-Refresh 20&nbsp;s.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {FLOWS.map((f) => {
          const last = latestByFlow.get(f.key);
          const p = (last?.payload ?? {}) as any;
          const Icon = f.icon;
          return (
            <Card key={f.key}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2"><Icon className="h-4 w-4" /> {f.label}</span>
                  {statusBadge(last?.result_status ?? null)}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{f.description}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Letzter Lauf: {last ? new Date(last.created_at).toLocaleString("de-DE") : "—"}
                </div>
                {last && (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <Metric label="OK" value={p.success ?? p.succeeded ?? p.ok ?? p.suggestions_upserted ?? p.enqueued ?? "—"} />
                    <Metric label="Failed" value={p.failed ?? p.documents_processed ? p.failed ?? 0 : (p.failed ?? "—")} tone={Number(p.failed) > 0 ? "bad" : undefined} />
                    <Metric label="Items" value={p.drained ?? p.pinged ?? p.sitemap_total ?? p.documents_updated ?? "—"} />
                  </div>
                )}
                {p?.error || p?.results?.find?.((r: any) => !r.ok)?.error ? (
                  <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive">
                    {p.error ?? p.results?.find?.((r: any) => !r.ok)?.error}
                  </div>
                ) : null}
                <Button size="sm" onClick={() => run(f)} disabled={busy !== null}>
                  {busy === f.key ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                  Jetzt ausführen
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Ereignis-Stream (letzte 60)</CardTitle></CardHeader>
        <CardContent>
          {!events?.length ? (
            <div className="text-sm text-muted-foreground">Noch keine Events.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zeit</TableHead>
                  <TableHead>Flow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">OK</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => {
                  const p = (e.payload ?? {}) as any;
                  const ok = p.success ?? p.succeeded ?? p.ok ?? p.suggestions_upserted ?? p.enqueued ?? "—";
                  const failed = p.failed ?? "—";
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleTimeString("de-DE")}</TableCell>
                      <TableCell className="text-xs font-mono">{e.action_type}</TableCell>
                      <TableCell>{statusBadge(e.result_status)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{String(ok)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{String(failed)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-md truncate" title={JSON.stringify(p)}>
                        {p.error ?? p.reason ?? p.action ?? JSON.stringify(p).slice(0, 120)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: any; tone?: "good" | "bad" }) {
  const cls = tone === "bad" ? "text-destructive" : tone === "good" ? "text-green-600" : "";
  return (
    <div className="rounded border bg-muted/30 px-2 py-1">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${cls}`}>{String(value)}</div>
    </div>
  );
}
