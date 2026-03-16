import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RotateCcw, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { recoverAndReenterPackage } from "@/lib/admin/recoverAndReenterPackage";

type ReentryMissRow = {
  package_id: string;
  title: string | null;
  status: string;
  open_steps: number;
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `vor ${hours}h ${rem}m`;
}

export default function ReentryMissesPanel() {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ops-reentry-misses"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_ops_reentry_misses")
        .select("*")
        .order("title", { ascending: true });
      if (error) throw error;
      return (data || []) as ReentryMissRow[];
    },
    refetchInterval: 60_000,
  });

  const healMutation = useMutation({
    mutationFn: async (packageId: string) => {
      return recoverAndReenterPackage(packageId, "re-entry miss heal from ops panel", "ops_panel");
    },
    onSuccess: (result) => {
      if (result.reentered) {
        toast.success(`Paket re-entered → building`);
      } else {
        toast.info(`Nicht eligible: ${result.reason || result.final_status}`);
      }
      queryClient.invalidateQueries({ queryKey: ["ops-reentry-misses"] });
    },
    onError: (err: Error) => {
      toast.error(`Heal fehlgeschlagen: ${err.message}`);
    },
  });

  const missCount = data?.length || 0;

  return (
    <Card className={missCount > 0 ? "border-destructive/30 bg-destructive/5" : "border-border"}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            {missCount > 0 ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            )}
            Re-Entry Misses
          </CardTitle>
          <CardDescription>
            Pakete in <code className="text-xs">queued</code> mit offenen Steps, aber ohne aktive Jobs.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="text-3xl font-semibold">{missCount}</div>
          <Badge variant={missCount > 0 ? "destructive" : "secondary"}>
            {missCount > 0 ? "Re-Entry fehlt" : "Kein Miss"}
          </Badge>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Lade…</div>
        ) : missCount === 0 ? (
          <div className="text-sm text-muted-foreground">
            Kein Paket hängt im Zustand „queued + offene Steps + keine Jobs".
          </div>
        ) : (
          <div className="space-y-3">
            {data!.map((row) => (
              <div
                key={row.package_id}
                className="rounded-lg border border-destructive/20 bg-background/70 p-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {row.title || row.package_id}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground font-mono truncate">
                      {row.package_id}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{row.open_steps} offene Steps</div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={healMutation.isPending}
                      onClick={() => healMutation.mutate(row.package_id)}
                    >
                      <Play className="mr-1 h-3 w-3" />
                      Heal
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
