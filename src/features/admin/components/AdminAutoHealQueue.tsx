import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import {
  getAdminAutoHealQueue,
  updateAdminAutoHealStatus,
  type AdminAutoHealQueueItem,
} from "@/features/admin/api/adminAutoHealApi";
import {
  getReleaseClassifications,
  type ReleaseClass,
  type ReleaseClassification,
} from "@/features/admin/api/releaseClassificationApi";
import {
  markContentGap,
  bulkHealByClass,
  zombieSweep,
} from "@/integrations/supabase/admin-ops-actions";
import { AutoHealActionBadge } from "@/features/admin/components/AutoHealActionBadge";
import { ReleaseClassBadge } from "@/features/admin/components/ReleaseClassBadge";
import { ContextSensitiveHealActions } from "@/features/admin/components/ContextSensitiveHealActions";
import { TestPriorityReasons } from "@/features/admin/components/TestPriorityReasons";
import { usePackageHealAction } from "@/lib/admin/heal/usePackageHealAction";
import { recommendHeal } from "@/lib/admin/heal/healService";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "🟡 Pending",
    processing: "🔵 Processing",
    done: "✅ Done",
    failed: "❌ Failed",
    cancelled: "⚪ Cancelled",
  };
  return (
    <span className="inline-flex rounded-full border px-2 py-1 text-xs">
      {map[status] ?? status}
    </span>
  );
}

export function AdminAutoHealQueue() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-auto-heal-queue", filter],
    queryFn: () => getAdminAutoHealQueue(filter),
    staleTime: 30_000,
  });

  const packageIds = useMemo(
    () => Array.from(new Set(data.map((d) => d.package_id))),
    [data],
  );

  const { data: classifications = [] } = useQuery({
    queryKey: ["release-classifications", packageIds],
    queryFn: () => getReleaseClassifications(packageIds),
    enabled: packageIds.length > 0,
    staleTime: 30_000,
  });

  const classByPkg = useMemo(() => {
    const m = new Map<string, ReleaseClassification>();
    for (const c of classifications) m.set(c.package_id, c);
    return m;
  }, [classifications]);

  const invalidateAll = async () => {
    await qc.invalidateQueries({ queryKey: ["admin-auto-heal-queue"] });
    await qc.invalidateQueries({ queryKey: ["release-classifications"] });
    await qc.invalidateQueries({ queryKey: ["admin-auto-test-queue"] });
    await qc.invalidateQueries({ queryKey: ["admin-course-test-run-latest"] });
    await qc.invalidateQueries({ queryKey: ["admin"] });
  };

  const statusMutation = useMutation({
    mutationFn: (params: {
      queueId: string;
      status: "processing" | "done" | "failed" | "cancelled";
    }) =>
      updateAdminAutoHealStatus({
        queueId: params.queueId,
        status: params.status,
      }),
    onSuccess: invalidateAll,
  });

  const heal = usePackageHealAction();

  const runHeal = async (
    packageId: string,
    queueId: string,
    mode: "soft" | "hard",
    deficitCodes: string[] | undefined,
    releaseClass: ReleaseClass | undefined,
  ) => {
    const rec = recommendHeal({
      hardFailReasons: deficitCodes,
      releaseClass: releaseClass ?? null,
      hasActiveJobs: false,
      isStuck: mode === "hard",
    });
    try {
      await heal.mutateAsync({
        packageId,
        mode,
        resetFromStep: mode === "soft" ? "auto_publish" : (rec.resetFromStep ?? "run_integrity_check"),
        reason: `auto_heal_queue:${mode}:${queueId}`,
        cancelActiveJobs: mode === "hard",
        enqueuePlan: mode === "hard" ? rec.enqueuePlan : undefined,
      });
      await updateAdminAutoHealStatus({ queueId, status: "done" });
      await invalidateAll();
    } catch {
      // toast already handled in hook
    }
  };

  const contentGapMutation = useMutation({
    mutationFn: async (params: { packageId: string; queueId: string }) => {
      const reason =
        window.prompt("Begründung für content_gap (optional)") ||
        "manual_review_content_insufficient";
      await markContentGap(params.packageId, reason);
      await updateAdminAutoHealStatus({ queueId: params.queueId, status: "done" });
    },
    onSuccess: async () => {
      toast.success("content_gap markiert");
      await invalidateAll();
    },
    onError: (err: Error) => toast.error("Mark content_gap fehlgeschlagen", { description: err.message }),
  });

  const bulkMutation = useMutation({
    mutationFn: async (params: {
      releaseClass: ReleaseClass;
      packageIds: string[];
      queueIds: string[];
    }) => {
      const res = await bulkHealByClass(params.releaseClass, params.packageIds);
      // Markiere alle ausgewählten Queue-Items als done
      await Promise.all(
        params.queueIds.map((id) =>
          updateAdminAutoHealStatus({ queueId: id, status: "done" }),
        ),
      );
      return res;
    },
    onSuccess: async (res: any) => {
      toast.success(`Bulk-Heal: ${res.succeeded}/${res.total} erfolgreich`);
      setSelected(new Set());
      await invalidateAll();
    },
    onError: (err: Error) =>
      toast.error("Bulk-Heal fehlgeschlagen", { description: err.message }),
  });

  const zombieMutation = useMutation({
    mutationFn: () => zombieSweep(30),
    onSuccess: async (res: any) => {
      toast.success(`Zombie-Sweep: ${res.swept} Jobs bereinigt`);
      await invalidateAll();
    },
    onError: (err: Error) =>
      toast.error("Zombie-Sweep fehlgeschlagen", { description: err.message }),
  });

  // Build bulk-action grouping by release_class
  const selectedByClass = useMemo(() => {
    const groups = new Map<ReleaseClass, { pkgIds: string[]; queueIds: string[] }>();
    for (const it of data) {
      if (!selected.has(it.id)) continue;
      const cls = classByPkg.get(it.package_id)?.release_class;
      if (!cls) continue;
      if (!groups.has(cls)) groups.set(cls, { pkgIds: [], queueIds: [] });
      const g = groups.get(cls)!;
      if (!g.pkgIds.includes(it.package_id)) g.pkgIds.push(it.package_id);
      g.queueIds.push(it.id);
    }
    return groups;
  }, [data, selected, classByPkg]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="rounded-2xl border p-5 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-lg font-semibold">Auto-Heal Queue</div>
          <div className="text-sm text-muted-foreground">
            Kontextsensitive Heal-Aktionen basierend auf release_classification.
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {[undefined, "pending", "processing", "done", "failed"].map((s) => (
            <Button
              key={s ?? "all"}
              size="sm"
              variant={filter === s ? "default" : "outline"}
              onClick={() => setFilter(s)}
            >
              {s ?? "Alle"}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={zombieMutation.isPending}
            onClick={() => zombieMutation.mutate()}
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
            title="Cancelt Jobs die >30min im processing hängen"
          >
            {zombieMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            )}
            Zombie-Sweep
          </Button>
        </div>
      </div>

      {/* Bulk-Action bar */}
      {selected.size > 0 && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm">
              <span className="font-medium">{selected.size}</span> ausgewählt — Bulk-Heal nach Klasse:
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Auswahl löschen
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from(selectedByClass.entries()).map(([cls, group]) => (
              <Button
                key={cls}
                size="sm"
                disabled={bulkMutation.isPending}
                onClick={() =>
                  bulkMutation.mutate({
                    releaseClass: cls,
                    packageIds: group.pkgIds,
                    queueIds: group.queueIds,
                  })
                }
                variant={cls === "release_ok" ? "default" : "outline"}
              >
                {bulkMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                )}
                {cls === "release_ok" && "🚀 Force-Publish"}
                {cls === "release_warn" && "⚠️ Reconcile"}
                {cls === "release_block" && "🛑 Reconcile"}
                <span className="ml-1.5 text-[10px] opacity-70">({group.pkgIds.length})</span>
              </Button>
            ))}
            {selectedByClass.size === 0 && (
              <div className="text-xs text-muted-foreground">
                Keine Klassifikation für ausgewählte Pakete verfügbar.
              </div>
            )}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-muted-foreground">Lade Auto-Heal-Queue…</div>
      )}

      <div className="space-y-3">
        {data.map((item: AdminAutoHealQueueItem) => {
          const cls = classByPkg.get(item.package_id);
          const actionable = item.status === "pending" || item.status === "processing";

          return (
            <div key={item.id} className="rounded-xl border p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {actionable && (
                    <Checkbox
                      checked={selected.has(item.id)}
                      onCheckedChange={() => toggleSelect(item.id)}
                      className="mt-0.5"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium font-mono text-sm truncate">
                      {cls?.course_title || item.package_id}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {item.package_id.slice(0, 8)} ·{" "}
                      {new Date(item.created_at).toLocaleString("de-DE")}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <StatusBadge status={item.status} />
                  <AutoHealActionBadge action={item.heal_action} />
                </div>
              </div>

              {/* Release-Classification */}
              <ReleaseClassBadge
                releaseClass={cls?.release_class}
                codes={cls?.deficiency_codes}
              />

              <TestPriorityReasons reasons={item.reason_codes} />

              {item.notes && (
                <div className="rounded-lg border p-2 text-sm text-muted-foreground">
                  {item.notes}
                </div>
              )}

              {actionable && (
                <div className="space-y-2 border-t pt-3">
                  <div className="text-xs font-medium text-muted-foreground">
                    Kontextsensitive Heal-Aktionen:
                  </div>
                  <ContextSensitiveHealActions
                    releaseClass={cls?.release_class}
                    busy={heal.isPending || contentGapMutation.isPending}
                    onSoftPublish={() =>
                      runHeal(item.package_id, item.id, "soft", cls?.deficiency_codes ?? undefined, cls?.release_class)
                    }
                    onHardHeal={() =>
                      runHeal(item.package_id, item.id, "hard", cls?.deficiency_codes ?? undefined, cls?.release_class)
                    }
                    onMarkContentGap={() =>
                      contentGapMutation.mutate({ packageId: item.package_id, queueId: item.id })
                    }
                  />

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 pt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={statusMutation.isPending || item.status === "processing"}
                      onClick={() =>
                        statusMutation.mutate({ queueId: item.id, status: "processing" })
                      }
                    >
                      In Bearbeitung
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={statusMutation.isPending}
                      onClick={() =>
                        statusMutation.mutate({ queueId: item.id, status: "done" })
                      }
                    >
                      Manuell Done
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={statusMutation.isPending}
                      onClick={() =>
                        statusMutation.mutate({ queueId: item.id, status: "failed" })
                      }
                    >
                      Failed
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={statusMutation.isPending}
                      onClick={() =>
                        statusMutation.mutate({ queueId: item.id, status: "cancelled" })
                      }
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {!isLoading && data.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Keine Auto-Heal-Einträge vorhanden.
          </div>
        )}
      </div>
    </div>
  );
}
