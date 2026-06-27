// STORE.OPS.BATCH.OS.1 — Admin batch orchestration card.
// Plan safe StoreOps actions across many manifests. No publish/submit/rollout.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ALLOWED_BATCH_ACTIONS, type BatchActionType } from "@/lib/storeOpsBatch";

type ManifestRow = { id: string; bundle_id: string | null; version_name: string | null };

type BatchRow = {
  id: string;
  batch_label: string | null;
  state: string;
  total: number;
  succeeded: number;
  failed: number;
  blocked: number;
  skipped: number;
  planned_at: string;
};

const ACTION_LABELS: Record<BatchActionType, string> = {
  generate_listing: "Listing generieren",
  enqueue_screenshots: "Screenshots einreihen",
  run_android_dry_build: "Android Dry-Build",
  run_ios_dry_build: "iOS Dry-Build",
  run_review_gate: "Review-Gate prüfen",
  run_kpi_snapshot: "KPI-Snapshot",
  create_release_candidate: "Release-Candidate erzeugen",
  evaluate_lifecycle: "Lifecycle evaluieren",
  export_submission_package: "Submission-Package exportieren",
};

const STATE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  planned: "secondary",
  running: "default",
  partially_completed: "secondary",
  completed: "default",
  blocked: "destructive",
  cancelled: "outline",
};

export function StoreOpsBatchCard() {
  const qc = useQueryClient();
  const [selectedManifests, setSelectedManifests] = useState<Set<string>>(new Set());
  const [selectedActions, setSelectedActions] = useState<Set<BatchActionType>>(new Set());

  const manifests = useQuery({
    queryKey: ["store-ops-batch-manifests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mobile_course_app_manifest" as any)
        .select("id, bundle_id, version_name")
        .order("version_name", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ManifestRow[];
    },
  });

  const batches = useQuery({
    queryKey: ["store-ops-batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("store_ops_batches" as any)
        .select("id, batch_label, state, total, succeeded, failed, blocked, skipped, planned_at")
        .order("planned_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as BatchRow[];
    },
  });

  const planMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("plan-store-ops-batch", {
        body: {
          manifest_ids: [...selectedManifests],
          selected_action_types: [...selectedActions],
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Batch geplant");
      setSelectedManifests(new Set());
      setSelectedActions(new Set());
      qc.invalidateQueries({ queryKey: ["store-ops-batches"] });
    },
    onError: (e: any) => toast.error(`Plan fehlgeschlagen: ${e.message ?? e}`),
  });

  const ready = selectedManifests.size > 0 && selectedActions.size > 0;

  const summary = useMemo(() => {
    const list = batches.data ?? [];
    return {
      total: list.length,
      active: list.filter((b) => ["planned", "running", "partially_completed"].includes(b.state)).length,
      blocked: list.filter((b) => b.state === "blocked").length,
    };
  }, [batches.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>StoreOps Batch — Multi-Manifest Orchestrierung</CardTitle>
        <p className="text-sm text-muted-foreground">
          Nur sichere Folgeaktionen. Kein Publish, kein Submit, kein Rollout.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-md border p-3"><div className="text-muted-foreground">Batches</div><div className="text-2xl font-semibold">{summary.total}</div></div>
          <div className="rounded-md border p-3"><div className="text-muted-foreground">Aktiv</div><div className="text-2xl font-semibold">{summary.active}</div></div>
          <div className="rounded-md border p-3"><div className="text-muted-foreground">Blockiert</div><div className="text-2xl font-semibold">{summary.blocked}</div></div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">Aktionen wählen</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {ALLOWED_BATCH_ACTIONS.map((a) => (
              <label key={a} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <Checkbox
                  checked={selectedActions.has(a)}
                  onCheckedChange={(v) => {
                    const next = new Set(selectedActions);
                    if (v) next.add(a); else next.delete(a);
                    setSelectedActions(next);
                  }}
                />
                <span>{ACTION_LABELS[a]}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">Manifeste wählen ({selectedManifests.size})</div>
          {manifests.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {(manifests.data ?? []).map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedManifests.has(m.id)}
                    onCheckedChange={(v) => {
                      const next = new Set(selectedManifests);
                      if (v) next.add(m.id); else next.delete(m.id);
                      setSelectedManifests(next);
                    }}
                  />
                  <span className="font-mono text-xs">{m.bundle_id ?? m.id}</span>
                  <span className="text-muted-foreground">v{m.version_name ?? "0.0.0"}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <Button onClick={() => planMutation.mutate()} disabled={!ready || planMutation.isPending}>
          {planMutation.isPending ? "Plane…" : "Batch planen"}
        </Button>

        <div>
          <div className="mb-2 text-sm font-medium">Letzte Batches</div>
          {batches.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (batches.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Batches.</p>
          ) : (
            <div className="space-y-2">
              {(batches.data ?? []).map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <div className="flex flex-col">
                    <span className="font-mono text-xs">{b.batch_label ?? b.id.slice(0, 8)}</span>
                    <span className="text-xs text-muted-foreground">{new Date(b.planned_at).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={STATE_VARIANT[b.state] ?? "outline"}>{b.state}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {b.succeeded}✓ · {b.failed}✗ · {b.blocked}⛔ · {b.skipped}↷ / {b.total}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
