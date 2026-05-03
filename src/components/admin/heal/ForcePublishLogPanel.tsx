import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Rocket, Search, AlertTriangle, Activity, ShieldAlert, Coins, Loader2 } from "lucide-react";
import { ForcePublishButton } from "@/components/admin/heal/ForcePublishButton";
import { toast } from "sonner";

function PricingBackfillTrigger() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_trigger_pricing_backfill_now" as never);
      if (error) throw error;
      return data as { processed: number; created_prices: number; skipped: number; errors: unknown[] };
    },
    onSuccess: (r) => {
      toast.success("Pricing-Backfill ausgeführt", {
        description: `processed=${r.processed} · created=${r.created_prices} · skipped=${r.skipped}`,
      });
      qc.invalidateQueries({ queryKey: ["admin-building-progress-48h"] });
    },
    onError: (e: Error) => toast.error("Backfill fehlgeschlagen", { description: e.message }),
  });
  return (
    <Card className="p-4 flex items-center justify-between gap-4 border-info/40 bg-info-bg-subtle">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-info" />
        <div>
          <div className="text-sm font-semibold">Pricing-Backfill (building/queued)</div>
          <div className="text-xs text-muted-foreground">
            Legt Default-Preise (24,90 € / 12 Mon.) für Pakete ohne aktiven Preis an.
          </div>
        </div>
      </div>
      <Button size="sm" variant="info" onClick={() => m.mutate()} disabled={m.isPending}>
        {m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Coins className="h-3.5 w-3.5" />}
        Jetzt ausführen
      </Button>
    </Card>
  );
}

// ─── Force-Publish log row ───────────────────────────────────────────────
interface ForcePublishRow {
  id: string;
  created_at: string;
  package_id: string | null;
  package_title: string | null;
  reason: string | null;
  previous_status: string | null;
  build_progress: number | null;
  cancelled_jobs: number | null;
  admin_user: string | null;
  admin_email: string | null;
  result_detail: string | null;
}

interface RemainingProducerRow {
  target_id: string;
  events: number;
  first_seen: string;
  last_seen: string;
  apps: string[] | null;
  users: string[] | null;
  client_addrs: string[] | null;
  trigger_sources: string[] | null;
  likely_cron: string;
}

interface BuildingProgressRow {
  package_id: string;
  title: string;
  build_progress: number | null;
  current_step: string | null;
  steps_done_48h: number;
  jobs_done_48h: number;
  last_progress_at: string;
  pkg_updated_at: string;
  has_progress: boolean;
}

interface AlertRow {
  id: string;
  created_at: string;
  result_detail: string;
  metadata: { event_count?: number; producers?: unknown[] };
}

function fmtTime(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("de-DE");
}

export function ForcePublishLogPanel() {
  const [search, setSearch] = useState("");

  const { data: logs, isLoading: loadingLogs } = useQuery({
    queryKey: ["admin-force-publish-log"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_force_publish_log" as never, { p_limit: 200 } as never);
      if (error) throw error;
      return (data ?? []) as unknown as ForcePublishRow[];
    },
    refetchInterval: 30_000,
  });

  const { data: producers, isLoading: loadingProducers } = useQuery({
    queryKey: ["admin-remaining-revert-producers"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_remaining_revert_producers" as never, { p_window_hours: 168 } as never);
      if (error) throw error;
      return (data ?? []) as unknown as RemainingProducerRow[];
    },
    refetchInterval: 60_000,
  });

  const { data: building, isLoading: loadingBuilding } = useQuery({
    queryKey: ["admin-building-progress-48h"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_building_progress_48h" as never, {} as never);
      if (error) throw error;
      return (data ?? []) as unknown as BuildingProgressRow[];
    },
    refetchInterval: 60_000,
  });

  const { data: alerts } = useQuery({
    queryKey: ["admin-remaining-producer-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auto_heal_log")
        .select("id, created_at, result_detail, metadata")
        .eq("action_type", "remaining_producer_alert")
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as AlertRow[];
    },
    refetchInterval: 30_000,
  });

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((r) =>
      [r.package_title, r.reason, r.admin_email, r.package_id, r.previous_status]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [logs, search]);

  const buildingSummary = useMemo(() => {
    if (!building) return null;
    return {
      total: building.length,
      with_progress: building.filter((b) => b.has_progress).length,
      stalled: building.filter((b) => !b.has_progress).length,
    };
  }, [building]);

  return (
    <div className="space-y-4">
      <PricingBackfillTrigger />
      {/* ── Active alerts (last 24h) ───────────────────────────────────── */}
      {alerts && alerts.length > 0 && (
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold text-destructive">
              Remaining-Producer Alerts (24h)
            </h3>
            <Badge variant="destructive" className="text-[10px]">{alerts.length}</Badge>
          </div>
          <div className="space-y-1">
            {alerts.slice(0, 5).map((a) => (
              <div key={a.id} className="text-xs">
                <span className="font-mono text-muted-foreground">{fmtTime(a.created_at)}</span>{" "}
                · {a.result_detail}
              </div>
            ))}
          </div>
        </Card>
      )}

      <RevertProducerDrilldownCard />

      {/* ── Remaining Producers (7d) ──────────────────────────────────── */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold">Remaining Producers (7d)</h3>
          <Badge variant="outline" className="text-[10px]">{producers?.length ?? 0}</Badge>
        </div>
        {loadingProducers ? (
          <Skeleton className="h-12" />
        ) : !producers || producers.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">
            ✅ Keine verbleibenden Revert-Producer in den letzten 7 Tagen.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-1.5 px-2">target_id</th>
                  <th className="text-right py-1.5 px-2">Events</th>
                  <th className="text-left py-1.5 px-2">First seen</th>
                  <th className="text-left py-1.5 px-2">Last seen</th>
                  <th className="text-left py-1.5 px-2">apps</th>
                  <th className="text-left py-1.5 px-2">users</th>
                  <th className="text-left py-1.5 px-2">Likely cron</th>
                </tr>
              </thead>
              <tbody>
                {producers.map((p) => (
                  <tr key={p.target_id} className="border-b hover:bg-muted/30">
                    <td className="py-1.5 px-2 font-mono text-[10px]">{p.target_id?.slice(0, 8) ?? "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-medium">{p.events}</td>
                    <td className="py-1.5 px-2 font-mono text-[10px]">{fmtTime(p.first_seen)}</td>
                    <td className="py-1.5 px-2 font-mono text-[10px]">{fmtTime(p.last_seen)}</td>
                    <td className="py-1.5 px-2 text-[11px] text-muted-foreground">
                      {(p.apps ?? []).join(", ") || "—"}
                    </td>
                    <td className="py-1.5 px-2 text-[11px] text-muted-foreground">
                      {(p.users ?? []).join(", ") || "—"}
                    </td>
                    <td className="py-1.5 px-2">
                      <Badge variant="outline" className="text-[10px]">{p.likely_cron}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Building progress 48h ─────────────────────────────────────── */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Building Progress (48h)</h3>
            {buildingSummary && (
              <>
                <Badge variant="outline" className="text-[10px]">{buildingSummary.total} total</Badge>
                <Badge variant="default" className="text-[10px]">{buildingSummary.with_progress} progressing</Badge>
                {buildingSummary.stalled > 0 && (
                  <Badge variant="destructive" className="text-[10px]">{buildingSummary.stalled} stalled</Badge>
                )}
              </>
            )}
          </div>
        </div>
        {loadingBuilding ? (
          <Skeleton className="h-20" />
        ) : !building || building.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">Keine building-Pakete.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-1.5 px-2">Paket</th>
                  <th className="text-right py-1.5 px-2">Progress</th>
                  <th className="text-left py-1.5 px-2">Step</th>
                  <th className="text-right py-1.5 px-2">Steps 48h</th>
                  <th className="text-right py-1.5 px-2">Jobs 48h</th>
                  <th className="text-left py-1.5 px-2">Last progress</th>
                  <th className="text-left py-1.5 px-2">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {building.map((b) => (
                  <tr key={b.package_id} className={`border-b hover:bg-muted/30 ${!b.has_progress ? "bg-destructive/5" : ""}`}>
                    <td className="py-1.5 px-2">
                      <div className="font-medium truncate max-w-[260px]" title={b.title}>{b.title}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{b.package_id.slice(0, 8)}</div>
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{b.build_progress ?? "—"}</td>
                    <td className="py-1.5 px-2 text-[11px] text-muted-foreground">{b.current_step ?? "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{b.steps_done_48h}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{b.jobs_done_48h}</td>
                    <td className="py-1.5 px-2 font-mono text-[10px]">
                      {b.has_progress ? fmtTime(b.last_progress_at) : <span className="text-destructive">no progress</span>}
                    </td>
                    <td className="py-1.5 px-2">
                      {(b.build_progress ?? 0) >= 100 && (
                        <ForcePublishButton
                          packageId={b.package_id}
                          packageTitle={b.title}
                          status="building"
                          buildProgress={b.build_progress}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Force-Publish audit log ───────────────────────────────────── */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Force-Publish Audit-Log</h3>
            <Badge variant="outline" className="text-[10px]">{logs?.length ?? 0}</Badge>
          </div>
          <div className="relative w-[260px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Paket, Reason, Admin, ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>

        {loadingLogs ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">Keine Force-Publish-Events.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-1.5 px-2">Wann</th>
                  <th className="text-left py-1.5 px-2">Paket</th>
                  <th className="text-left py-1.5 px-2">Vorher</th>
                  <th className="text-right py-1.5 px-2">Progress</th>
                  <th className="text-right py-1.5 px-2">Cancelled</th>
                  <th className="text-left py-1.5 px-2">Admin</th>
                  <th className="text-left py-1.5 px-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-muted/30">
                    <td className="py-1.5 px-2 font-mono text-[10px] whitespace-nowrap">{fmtTime(r.created_at)}</td>
                    <td className="py-1.5 px-2">
                      <div className="font-medium">{r.package_title ?? "—"}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{r.package_id?.slice(0, 8) ?? "—"}</div>
                    </td>
                    <td className="py-1.5 px-2"><Badge variant="outline" className="text-[10px]">{r.previous_status ?? "?"}</Badge></td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{r.build_progress ?? "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{r.cancelled_jobs ?? 0}</td>
                    <td className="py-1.5 px-2 text-[11px]">
                      {r.admin_email ?? <span className="font-mono text-muted-foreground">{r.admin_user?.slice(0, 8) ?? "—"}</span>}
                    </td>
                    <td className="py-1.5 px-2 text-[11px] text-muted-foreground max-w-[280px] truncate" title={r.reason ?? ""}>
                      {r.reason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
