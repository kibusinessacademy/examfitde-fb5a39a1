import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminRpc } from "@/integrations/supabase/admin-rpc";
import {
  healFinalizationStall,
  healNonBuilding,
  runAdminOpsAction,
  resetStaleProcessingJobs,
  cancelZombieNoopJobs,
} from "@/integrations/supabase/admin-ops-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Wrench, Loader2, Play, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export default function RecoveryBoardCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "recovery-board"],
    queryFn: adminRpc.recoveryBoard,
    refetchInterval: 30_000,
  });

  const healFin = useMutation({
    mutationFn: () => healFinalizationStall(20),
    onSuccess: (res: any) => {
      toast.success(`Finalization Heal: ${res?.healed_count ?? 0} Pakete requeued`);
      qc.invalidateQueries({ queryKey: ["admin", "recovery-board"] });
    },
    onError: (e) => toast.error(`Heal failed: ${e.message}`),
  });

  const healNB = useMutation({
    mutationFn: () => healNonBuilding(20),
    onSuccess: (res: any) => {
      toast.success(`Non-Building Heal: ${res?.healed_count ?? 0} Pakete normalisiert`);
      qc.invalidateQueries({ queryKey: ["admin", "recovery-board"] });
    },
    onError: (e) => toast.error(`Heal failed: ${e.message}`),
  });

  const retryStep = useMutation({
    mutationFn: async ({ packageId, stepKey }: { packageId: string; stepKey: string }) => {
      return runAdminOpsAction('retry_package_step', { package_id: packageId, step_key: stepKey });
    },
    onSuccess: () => {
      toast.success('Step neu gestartet');
      qc.invalidateQueries({ queryKey: ["admin", "recovery-board"] });
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const finTotal = data?.finalization_stall?.total ?? 0;
  const nbTotal = data?.non_building_recoverable?.total ?? 0;

  if (!isLoading && finTotal === 0 && nbTotal === 0) return null;

  return (
    <Card className="border-orange-500/40 bg-orange-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-orange-500" />
          Recovery Board
          {(finTotal + nbTotal) > 0 && (
            <Badge variant="destructive" className="ml-auto">{finTotal + nbTotal} recoverable</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Finalization Stall */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              <span className="text-sm font-medium">Finalization Stall</span>
              <Badge variant="outline" className="text-xs">{finTotal}</Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => healFin.mutate()}
              disabled={healFin.isPending || finTotal === 0}
              className="h-7 text-xs"
            >
              {healFin.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Heal All
            </Button>
          </div>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {data?.finalization_stall?.packages?.slice(0, 10).map((p) => (
                <div key={p.package_id} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1 gap-1">
                  <Link to={`/admin/studio/${p.package_id}`} className="font-mono truncate max-w-[100px] hover:text-primary transition-colors">
                    {p.package_id.slice(0, 8)}
                  </Link>
                  <span className="text-muted-foreground shrink-0">
                    {p.content_lessons}/{p.total_lessons} · {p.build_progress}%
                  </span>
                  <Badge variant="outline" className="text-[10px] shrink-0">{p.finalize_status}</Badge>
                  <Button
                    size="sm" variant="ghost"
                    className="h-5 w-5 p-0 shrink-0"
                    disabled={retryStep.isPending}
                    onClick={() => retryStep.mutate({ packageId: p.package_id, stepKey: 'finalize_learning_content' })}
                    title="Finalize neu starten"
                  >
                    {retryStep.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Non-Building */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
              <span className="text-sm font-medium">Non-Building Recoverable</span>
              <Badge variant="outline" className="text-xs">{nbTotal}</Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => healNB.mutate()}
              disabled={healNB.isPending || nbTotal === 0}
              className="h-7 text-xs"
            >
              {healNB.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Heal All
            </Button>
          </div>
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {data?.non_building_recoverable?.packages?.slice(0, 10).map((p) => (
                <div key={p.package_id} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1 gap-1">
                  <Link to={`/admin/studio/${p.package_id}`} className="font-mono truncate max-w-[100px] hover:text-primary transition-colors">
                    {p.package_id.slice(0, 8)}
                  </Link>
                  <span className="text-muted-foreground shrink-0">
                    {p.status} · {p.open_steps} open
                  </span>
                  {p.blocked_reason && (
                    <Badge variant="outline" className="text-[10px] text-destructive truncate max-w-[80px] shrink-0">
                      {p.blocked_reason}
                    </Badge>
                  )}
                  <Button
                    size="sm" variant="ghost"
                    className="h-5 w-5 p-0 shrink-0"
                    disabled={retryStep.isPending}
                    onClick={() => retryStep.mutate({ packageId: p.package_id, stepKey: p.first_open_step || 'generate_learning_content' })}
                    title={`${p.first_open_step} neu starten`}
                  >
                    {retryStep.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
