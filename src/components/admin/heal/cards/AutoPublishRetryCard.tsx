/**
 * AutoPublishRetryCard — Targeted Auto-Publish Retry mit Rescan + Error-Klassifizierung
 *
 * - Multi-Select: Paket-IDs (Textarea, eine pro Zeile oder kommasepariert)
 * - Aktion: setzt failed `auto_publish` Steps zurück auf queued + enqueued package_auto_publish Jobs mit bronze_lock_override=true
 * - Auto-Rescan: poll alle 60s für 10min, klassifiziert last_error in TRACK_GUARD / PRICING_PRODUCT / PUBLISH_ARTIFACT / BRONZE_LOCK / PARKED_PREREQ / NOOP_LOOP / OTHER
 * - Toast-Notification, sobald ein neuer last_error erkannt wird
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Play, RefreshCw, Rocket } from "lucide-react";

type StatusRow = {
  package_id: string;
  title: string | null;
  pkg_status: string | null;
  auto_publish_step: string | null;
  latest_job_status: string | null;
  latest_job_updated_at: string | null;
  last_error: string | null;
  error_group:
    | "TRACK_GUARD"
    | "PRICING_PRODUCT"
    | "PUBLISH_ARTIFACT"
    | "BRONZE_LOCK"
    | "PARKED_PREREQ"
    | "NOOP_LOOP"
    | "OTHER"
    | null;
  council_approved: boolean | null;
};

const GROUP_TONE: Record<string, string> = {
  TRACK_GUARD: "bg-warning-bg-subtle text-warning border-warning/30",
  PRICING_PRODUCT: "bg-destructive-bg-subtle text-destructive border-destructive/30",
  PUBLISH_ARTIFACT: "bg-destructive-bg-subtle text-destructive border-destructive/30",
  BRONZE_LOCK: "bg-warning-bg-subtle text-warning border-warning/30",
  PARKED_PREREQ: "bg-muted text-muted-foreground border-border",
  NOOP_LOOP: "bg-muted text-muted-foreground border-border",
  OTHER: "bg-muted text-muted-foreground border-border",
};

const RESCAN_INTERVAL_MS = 60_000;
const RESCAN_DURATION_MS = 10 * 60_000;

function parseIds(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)),
    ),
  );
}

export function AutoPublishRetryCard() {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [rescanStartedAt, setRescanStartedAt] = useState<number | null>(null);
  const seenErrors = useRef<Map<string, string>>(new Map());

  const ids = useMemo(() => parseIds(input), [input]);

  const status = useQuery({
    queryKey: ["auto-publish-retry-status", activeIds],
    enabled: activeIds.length > 0,
    refetchInterval:
      rescanStartedAt && Date.now() - rescanStartedAt < RESCAN_DURATION_MS ? RESCAN_INTERVAL_MS : false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_auto_publish_retry_status", {
        p_package_ids: activeIds,
      });
      if (error) throw error;
      return (data ?? []) as StatusRow[];
    },
  });

  // Klassifizierungs-Diff → Toast bei neu erkanntem Block
  useEffect(() => {
    if (!status.data) return;
    for (const row of status.data) {
      const key = `${row.package_id}:${row.error_group ?? ""}`;
      const prev = seenErrors.current.get(row.package_id);
      if (row.error_group && prev !== row.error_group) {
        if (prev !== undefined) {
          toast({
            title: `Neuer Block erkannt: ${row.error_group}`,
            description: `${row.title ?? row.package_id.slice(0, 8)} — ${row.last_error?.slice(0, 120) ?? ""}`,
            variant:
              row.error_group === "PRICING_PRODUCT" || row.error_group === "PUBLISH_ARTIFACT"
                ? "destructive"
                : "default",
          });
        }
        seenErrors.current.set(row.package_id, row.error_group);
      } else if (!row.error_group && row.pkg_status === "published") {
        if (prev !== "PUBLISHED") {
          toast({ title: "Veröffentlicht", description: row.title ?? row.package_id.slice(0, 8) });
          seenErrors.current.set(row.package_id, "PUBLISHED");
        }
      }
      void key;
    }
  }, [status.data]);

  const retry = useMutation({
    mutationFn: async () => {
      if (ids.length === 0) throw new Error("Keine gültigen Paket-IDs erkannt");
      const { data, error } = await supabase.rpc("admin_retry_auto_publish_for_packages", {
        p_package_ids: ids,
      });
      if (error) throw error;
      return data as { jobs_inserted: number; step_resets: number; skipped: unknown[] };
    },
    onSuccess: (res) => {
      toast({
        title: "Auto-Publish Retry ausgelöst",
        description: `${res.jobs_inserted} Jobs eingeplant · ${res.step_resets} Steps zurückgesetzt`,
      });
      seenErrors.current.clear();
      setActiveIds(ids);
      setRescanStartedAt(Date.now());
      qc.invalidateQueries({ queryKey: ["manual-retry-audit"] });
    },
    onError: (err: any) => {
      toast({ title: "Retry fehlgeschlagen", description: err.message, variant: "destructive" });
    },
  });

  const isRescanning = !!(rescanStartedAt && Date.now() - rescanStartedAt < RESCAN_DURATION_MS);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          Targeted Auto-Publish Retry
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription className="text-sm">
            Setzt failed <code>auto_publish</code> Steps der ausgewählten Pakete auf <code>queued</code> und legt
            einen neuen Job mit <code>bronze_lock_override=true</code> an. Audit-Eintrag:{" "}
            <code>manual_targeted_auto_publish_retry</code>.
          </AlertDescription>
        </Alert>

        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paket-UUIDs (eine pro Zeile oder kommasepariert)"
          rows={4}
          className="font-mono text-xs"
        />
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {ids.length} gültige UUID(s) erkannt
            {isRescanning && (
              <span className="ml-2 inline-flex items-center gap-1 text-primary">
                <RefreshCw className="h-3 w-3 animate-spin" /> Rescan aktiv (alle 60s, 10min)
              </span>
            )}
          </div>
          <Button
            onClick={() => retry.mutate()}
            disabled={ids.length === 0 || retry.isPending}
            size="sm"
          >
            <Play className="h-3 w-3 mr-1" />
            {retry.isPending ? "..." : `Retry für ${ids.length} Paket(e)`}
          </Button>
        </div>

        {status.data && status.data.length > 0 && (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-2 py-1">Paket</th>
                  <th className="text-left px-2 py-1">Pkg</th>
                  <th className="text-left px-2 py-1">Step</th>
                  <th className="text-left px-2 py-1">Job</th>
                  <th className="text-left px-2 py-1">Council</th>
                  <th className="text-left px-2 py-1">Fehler-Gruppe</th>
                </tr>
              </thead>
              <tbody>
                {status.data.map((row) => (
                  <tr key={row.package_id} className="border-t">
                    <td className="px-2 py-1">
                      <div className="font-medium">{row.title ?? row.package_id.slice(0, 8)}</div>
                      <div className="text-muted-foreground font-mono text-[10px]">
                        {row.package_id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <Badge variant="outline">{row.pkg_status}</Badge>
                    </td>
                    <td className="px-2 py-1">
                      <Badge variant="outline">{row.auto_publish_step ?? "—"}</Badge>
                    </td>
                    <td className="px-2 py-1">
                      <Badge variant="outline">{row.latest_job_status ?? "—"}</Badge>
                    </td>
                    <td className="px-2 py-1">{row.council_approved ? "✓" : "—"}</td>
                    <td className="px-2 py-1">
                      {row.error_group ? (
                        <span title={row.last_error ?? ""}>
                          <Badge className={GROUP_TONE[row.error_group]}>{row.error_group}</Badge>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">ok</span>
                      )}
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
