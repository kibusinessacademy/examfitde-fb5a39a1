/**
 * PostPublishOrchestratorCard — Post-Publish Commerce & Growth Orchestrator v1
 *
 * Quelle: v_post_publish_readiness (service-role, via admin_get_post_publish_readiness)
 * RPC:    admin_repair_post_publish_package(p_package_id, p_repair_reason)
 *
 * Zeigt published Pakete + readiness_state (READY, COMMERCE_REPAIR_REQUIRED,
 * NOT_SELLABLE, SEO_PENDING, PARTIAL) und erlaubt Per-Paket-Repair pro Reason.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type State =
  | "READY"
  | "COMMERCE_REPAIR_REQUIRED"
  | "NOT_SELLABLE"
  | "SEO_PENDING"
  | "PARTIAL";

type Row = {
  package_id: string;
  package_key: string | null;
  package_title: string;
  commerce_gate_state: string;
  is_sellable: boolean;
  product_public: boolean;
  has_stripe_price: boolean;
  lesson_ready: boolean;
  seo_present: boolean;
  license_template_ready: boolean;
  last_audit_at: string | null;
  minutes_since_audit: number | null;
  repair_reasons: string[] | null;
  readiness_state: State;
};

const STATE_FILTERS: { label: string; value: string | null }[] = [
  { label: "Alle", value: null },
  { label: "READY", value: "READY" },
  { label: "COMMERCE_REPAIR", value: "COMMERCE_REPAIR_REQUIRED" },
  { label: "NOT_SELLABLE", value: "NOT_SELLABLE" },
  { label: "SEO_PENDING", value: "SEO_PENDING" },
  { label: "PARTIAL", value: "PARTIAL" },
];

function stateBadge(s: State) {
  if (s === "READY")
    return <Badge className="bg-success-bg-subtle text-success border-success/30">READY</Badge>;
  if (s === "COMMERCE_REPAIR_REQUIRED")
    return <Badge variant="destructive">COMMERCE_REPAIR</Badge>;
  if (s === "NOT_SELLABLE")
    return <Badge className="bg-warning-bg-subtle text-warning border-warning/30">NOT_SELLABLE</Badge>;
  if (s === "SEO_PENDING")
    return <Badge variant="secondary">SEO_PENDING</Badge>;
  return <Badge variant="outline">PARTIAL</Badge>;
}

export function PostPublishOrchestratorCard() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | null>(null);
  const [repairing, setRepairing] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin", "post-publish-readiness", filter],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await (supabase as any).rpc(
        "admin_get_post_publish_readiness",
        { p_state_filter: filter, p_limit: 200 },
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  async function repair(pkg: string, reason: string, title: string) {
    setRepairing(`${pkg}:${reason}`);
    try {
      const { data, error } = await (supabase as any).rpc(
        "admin_repair_post_publish_package",
        { p_package_id: pkg, p_repair_reason: reason },
      );
      if (error) throw error;
      const r = data as { ok: boolean; reason?: string; job_id?: string };
      if (r?.ok) toast.success(`${title}: repair ${reason} enqueued`);
      else toast.warning(`${title}: ${r?.reason ?? "noop"}`);
      qc.invalidateQueries({ queryKey: ["admin", "post-publish-readiness"] });
    } catch (e: any) {
      toast.error(`Repair failed: ${e.message}`);
    } finally {
      setRepairing(null);
    }
  }

  const rows = data ?? [];
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.readiness_state] = (acc[r.readiness_state] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">
            Post-Publish Orchestrator
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              published → sellable → discoverable
            </span>
          </CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={filter ?? "__all"}
            onValueChange={(v) => setFilter(v === "__all" ? null : v)}
          >
            <SelectTrigger className="w-[180px] h-8">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              {STATE_FILTERS.map((f) => (
                <SelectItem key={f.value ?? "__all"} value={f.value ?? "__all"}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              {(["READY", "COMMERCE_REPAIR_REQUIRED", "NOT_SELLABLE", "SEO_PENDING", "PARTIAL"] as State[]).map(
                (s) => (
                  <div key={s} className="flex items-center gap-1.5">
                    {stateBadge(s)}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {counts[s] ?? 0}
                    </span>
                  </div>
                ),
              )}
            </div>
            <ScrollArea className="h-[420px]">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-2">Paket</th>
                    <th className="py-1 pr-2">State</th>
                    <th className="py-1 pr-2">Gate</th>
                    <th className="py-1 pr-2">Audit</th>
                    <th className="py-1 pr-2">Repair</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-muted-foreground py-6">
                        Keine Pakete in diesem Filter.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.package_id} className="border-t border-border/40">
                      <td className="py-1.5 pr-2">
                        <div className="font-medium">{r.package_title}</div>
                        <div className="text-muted-foreground">
                          {r.package_key ?? r.package_id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2">{stateBadge(r.readiness_state)}</td>
                      <td className="py-1.5 pr-2">
                        <div className="flex flex-wrap gap-1">
                          {r.product_public ? null : (
                            <Badge variant="outline" className="text-[10px]">no product</Badge>
                          )}
                          {r.has_stripe_price ? null : (
                            <Badge variant="outline" className="text-[10px]">no price</Badge>
                          )}
                          {r.lesson_ready ? null : (
                            <Badge variant="outline" className="text-[10px]">lesson gate</Badge>
                          )}
                          {r.seo_present ? null : (
                            <Badge variant="outline" className="text-[10px]">no seo</Badge>
                          )}
                          {r.is_sellable && r.lesson_ready && r.seo_present && (
                            <span className="text-success">✓</span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums">
                        {r.minutes_since_audit == null
                          ? "—"
                          : `${Math.round(r.minutes_since_audit)}m`}
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="flex flex-wrap gap-1">
                          {(r.repair_reasons ?? []).map((reason) => {
                            const busyKey = `${r.package_id}:${reason}`;
                            return (
                              <Button
                                key={reason}
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px]"
                                disabled={repairing === busyKey}
                                onClick={() => repair(r.package_id, reason, r.package_title)}
                              >
                                <Wrench className="h-3 w-3 mr-1" />
                                {reason}
                              </Button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
}
