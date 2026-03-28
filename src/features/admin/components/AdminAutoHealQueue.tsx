import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  getAdminAutoHealQueue,
  updateAdminAutoHealStatus,
  type AdminAutoHealQueueItem,
} from "@/features/admin/api/adminAutoHealApi";
import { AutoHealActionBadge } from "@/features/admin/components/AutoHealActionBadge";
import { TestPriorityReasons } from "@/features/admin/components/TestPriorityReasons";

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

  const { data = [], isLoading } = useQuery({
    queryKey: ["admin-auto-heal-queue", filter],
    queryFn: () => getAdminAutoHealQueue(filter),
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (params: {
      queueId: string;
      status: "processing" | "done" | "failed" | "cancelled";
    }) =>
      updateAdminAutoHealStatus({
        queueId: params.queueId,
        status: params.status,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-auto-heal-queue"] });
      await qc.invalidateQueries({ queryKey: ["admin-auto-test-queue"] });
      await qc.invalidateQueries({ queryKey: ["admin-course-test-run-latest"] });
    },
  });

  return (
    <div className="rounded-2xl border p-5 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-lg font-semibold">Auto-Heal Queue</div>
          <div className="text-sm text-muted-foreground">
            Automatisch erzeugte Reparaturaufträge aus QA-Befunden.
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground">Lade Auto-Heal-Queue…</div>
      )}

      <div className="space-y-3">
        {data.map((item: AdminAutoHealQueueItem) => (
          <div key={item.id} className="rounded-xl border p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium font-mono text-sm truncate">
                  {item.package_id}
                </div>
                <div className="text-xs text-muted-foreground">
                  Erstellt: {new Date(item.created_at).toLocaleString("de-DE")}
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 shrink-0">
                <StatusBadge status={item.status} />
                <AutoHealActionBadge action={item.heal_action} />
              </div>
            </div>

            <TestPriorityReasons reasons={item.reason_codes} />

            {item.notes && (
              <div className="rounded-lg border p-2 text-sm text-muted-foreground">
                {item.notes}
              </div>
            )}

            {item.status === "pending" || item.status === "processing" ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mutation.isPending || item.status === "processing"}
                  onClick={() =>
                    mutation.mutate({ queueId: item.id, status: "processing" })
                  }
                >
                  In Bearbeitung
                </Button>
                <Button
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({ queueId: item.id, status: "done" })
                  }
                >
                  Done
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({ queueId: item.id, status: "failed" })
                  }
                >
                  Failed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({ queueId: item.id, status: "cancelled" })
                  }
                >
                  Cancel
                </Button>
              </div>
            ) : null}
          </div>
        ))}

        {!isLoading && data.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Keine Auto-Heal-Einträge vorhanden.
          </div>
        )}
      </div>
    </div>
  );
}
