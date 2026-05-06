import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Candidate = {
  package_id: string;
  package_key: string;
  title: string;
  curriculum_id: string;
  status: string;
  blocked_reason: string;
  approved_count: number;
  shortfall_to_min: number;
  topup_attempts: number;
  last_dispatched_at: string | null;
};

export function ContentGapTopupCard() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["content-gap-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_content_gap_candidates" as any);
      if (error) throw error;
      return (data ?? []) as Candidate[];
    },
    refetchInterval: 30_000,
  });

  const dispatchMut = useMutation({
    mutationFn: async (packageId: string) => {
      const { data, error } = await supabase.rpc("admin_content_gap_topup_dispatch" as any, {
        p_package_id: packageId,
        p_dry_run: false,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      if (res?.dispatched) toast.success(`Top-up dispatched (shortfall ${res.shortfall})`);
      else if (res?.skipped) toast.info(`Skipped: ${res.reason}`);
      qc.invalidateQueries({ queryKey: ["content-gap-candidates"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Dispatch failed"),
    onSettled: () => setBusyId(null),
  });

  const recheckMut = useMutation({
    mutationFn: async (packageId: string) => {
      const { data, error } = await supabase.rpc("admin_content_gap_audit_recheck" as any, {
        p_package_id: packageId,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      if (res?.unblocked) toast.success("Unblocked & re-entered audit");
      else if (res?.skipped) toast.info(`Skipped: ${res.reason} (approved=${res.approved})`);
      qc.invalidateQueries({ queryKey: ["content-gap-candidates"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Recheck failed"),
    onSettled: () => setBusyId(null),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Content-Gap Top-Up
          <Badge variant="outline">{data?.length ?? 0} Restpakete</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Pakete mit &lt; 50 approved Questions. Top-Up füllt nur fehlende Fragen auf — kein Status-Bypass, kein Force-Publish. Nach ≥ 50 → Recheck reaktiviert das Audit.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Restpakete — alle Content-Lücken geschlossen.</p>
        ) : (
          <div className="space-y-3">
            {data!.map((c) => (
              <div
                key={c.package_id}
                className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{c.approved_count} / 50 approved</Badge>
                    <Badge variant="outline">−{c.shortfall_to_min} fehlend</Badge>
                    <span>Versuche: {c.topup_attempts}</span>
                    {c.last_dispatched_at && (
                      <span>letzter Run: {new Date(c.last_dispatched_at).toLocaleString()}</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={busyId === c.package_id}
                    onClick={() => {
                      setBusyId(c.package_id);
                      dispatchMut.mutate(c.package_id);
                    }}
                  >
                    Top-Up
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === c.package_id || c.approved_count < 50}
                    onClick={() => {
                      setBusyId(c.package_id);
                      recheckMut.mutate(c.package_id);
                    }}
                  >
                    Recheck
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
