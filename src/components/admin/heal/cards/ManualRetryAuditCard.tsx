/**
 * ManualRetryAuditCard — auto_heal_log-Audit-View für manuelle Retry-Aktionen
 *
 * Filter:
 *   - action_type (Multi-Select Quick-Presets)
 *   - package_id (UUID)
 *   - Zeitfenster (1h / 24h / 7d / custom)
 */
import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { History, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";

type AuditRow = {
  id: string;
  created_at: string;
  action_type: string;
  result_status: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  package_ids: string[];
};

const ACTION_PRESETS: { value: string; label: string }[] = [
  { value: "__manual__", label: "Alle manuellen Retries" },
  { value: "manual_targeted_auto_publish_retry", label: "Targeted Auto-Publish Retry" },
  { value: "manual_cluster_b_c_auto_publish_retry", label: "Cluster B/C Retry (legacy)" },
  { value: "council_approved_artifact_backfill", label: "Council-Artifact Backfill" },
  { value: "council_approved_artifact_autoset", label: "Council-Artifact Auto-Set" },
  { value: "bronze_tail_auto_unlock_inline", label: "Bronze Tail Unlock" },
];

const WINDOW_PRESETS: { value: string; label: string; hours: number }[] = [
  { value: "1h", label: "Letzte Stunde", hours: 1 },
  { value: "24h", label: "Letzte 24 Stunden", hours: 24 },
  { value: "7d", label: "Letzte 7 Tage", hours: 24 * 7 },
];

export function ManualRetryAuditCard() {
  const [action, setAction] = useState<string>("__manual__");
  const [packageId, setPackageId] = useState<string>("");
  const [windowKey, setWindowKey] = useState<string>("24h");

  const sinceHours = WINDOW_PRESETS.find((w) => w.value === windowKey)?.hours ?? 24;

  const audit = useQuery({
    queryKey: ["manual-retry-audit", action, packageId, windowKey],
    queryFn: async () => {
      const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(packageId);
      const { data, error } = await supabase.rpc("admin_get_manual_retry_audit", {
        p_action_types: action ? [action] : undefined,
        p_package_id: isUuid ? packageId : undefined,
        p_since: since,
        p_until: new Date().toISOString(),
        p_limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4" />
          Manuelle Retry-Aktionen (auto_heal_log)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="Aktion" />
            </SelectTrigger>
            <SelectContent>
              {ACTION_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Paket-UUID (optional)"
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            className="font-mono text-xs"
          />
          <Select value={windowKey} onValueChange={setWindowKey}>
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => audit.refetch()}
            disabled={audit.isFetching}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${audit.isFetching ? "animate-spin" : ""}`} />
            Aktualisieren
          </Button>
        </div>

        <div className="text-xs text-muted-foreground">
          {audit.data?.length ?? 0} Einträge im gewählten Fenster
        </div>

        <ScrollArea className="h-[420px] border rounded-md">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1">Zeit</th>
                <th className="text-left px-2 py-1">Aktion</th>
                <th className="text-left px-2 py-1">Status</th>
                <th className="text-left px-2 py-1">Pakete</th>
                <th className="text-left px-2 py-1">Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.data?.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                    {formatDistanceToNow(new Date(row.created_at), { locale: de, addSuffix: true })}
                  </td>
                  <td className="px-2 py-1 font-mono">{row.action_type}</td>
                  <td className="px-2 py-1">
                    <Badge
                      variant="outline"
                      className={
                        row.result_status === "success"
                          ? "border-success/40 text-success"
                          : row.result_status === "failed"
                            ? "border-destructive/40 text-destructive"
                            : ""
                      }
                    >
                      {row.result_status}
                    </Badge>
                  </td>
                  <td className="px-2 py-1">
                    {row.package_ids.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {row.package_ids.slice(0, 3).map((pid) => (
                          <code key={pid} className="text-[10px]">
                            {pid.slice(0, 8)}
                          </code>
                        ))}
                        {row.package_ids.length > 3 && (
                          <span className="text-muted-foreground text-[10px]">
                            +{row.package_ids.length - 3} weitere
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1 max-w-md">
                    <code className="text-[10px] block truncate" title={JSON.stringify(row.metadata)}>
                      {JSON.stringify(row.metadata)?.slice(0, 120)}
                    </code>
                  </td>
                </tr>
              ))}
              {audit.data?.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-6 text-muted-foreground">
                    Keine Einträge im gewählten Fenster
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
