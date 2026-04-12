import { useState } from "react";
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
import {
  AlertTriangle,
  Wrench,
  Loader2,
  Play,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Info,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

/* ── Result panel for Safety-Net actions ── */

interface ActionResult {
  count: number;
  jobs?: { job_id: string; job_type: string; package_id?: string }[];
  timestamp: Date;
}

function SafetyNetResultPanel({ label, result }: { label: string; result: ActionResult | null }) {
  if (!result) return null;

  const isIdempotent = result.count === 0;
  const jobTypes = [...new Set(result.jobs?.map((j) => j.job_type) ?? [])];

  return (
    <div className="rounded-lg border bg-muted/30 p-2.5 space-y-1.5 text-xs animate-in fade-in-50 slide-in-from-top-2 duration-200">
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-1.5 font-medium">
          {isIdempotent ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Info className="h-3.5 w-3.5 text-primary" />
          )}
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" />
          {result.timestamp.toLocaleTimeString("de-DE")}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 items-center">
        <Badge variant={isIdempotent ? "secondary" : "default"} className="text-[10px]">
          {result.count} betroffen
        </Badge>
        {isIdempotent && (
          <span className="text-muted-foreground">Keine Änderungen – Queue ist sauber ✓</span>
        )}
        {jobTypes.map((jt) => (
          <Badge key={jt} variant="outline" className="text-[10px] font-mono">
            {jt}
          </Badge>
        ))}
      </div>

      {result.jobs && result.jobs.length > 0 && result.jobs.length <= 10 && (
        <div className="space-y-0.5 pt-1">
          {result.jobs.map((j) => (
            <div key={j.job_id} className="flex gap-2 text-muted-foreground font-mono">
              <span className="truncate max-w-[80px]">{j.job_id.slice(0, 8)}</span>
              <span className="truncate">{j.job_type}</span>
              {j.package_id && (
                <Link
                  to={`/admin/studio/${j.package_id}`}
                  className="truncate max-w-[80px] hover:text-primary transition-colors"
                >
                  {j.package_id.slice(0, 8)}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RecoveryBoardCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "recovery-board"],
    queryFn: adminRpc.recoveryBoard,
    refetchInterval: 30_000,
  });

  /* ── Last result state for Safety-Net actions ── */
  const [staleResult, setStaleResult] = useState<ActionResult | null>(null);
  const [zombieResult, setZombieResult] = useState<ActionResult | null>(null);

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
      return runAdminOpsAction("retry_package_step", {
        package_id: packageId,
        step_key: stepKey,
      });
    },
    onSuccess: () => {
      toast.success("Step neu gestartet");
      qc.invalidateQueries({ queryKey: ["admin", "recovery-board"] });
    },
    onError: (e) => toast.error(`Fehler: ${e.message}`),
  });

  const resetStale = useMutation({
    mutationFn: () => resetStaleProcessingJobs(),
    onSuccess: (res: any) => {
      const count = res?.reset_count ?? 0;
      setStaleResult({
        count,
        jobs: res?.jobs ?? [],
        timestamp: new Date(),
      });
      toast.success(`Stale Processing Reset: ${count} Jobs zurückgesetzt`);
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => toast.error(`Reset failed: ${e.message}`),
  });

  const cancelZombies = useMutation({
    mutationFn: () => cancelZombieNoopJobs(),
    onSuccess: (res: any) => {
      const count = res?.cancelled_count ?? 0;
      setZombieResult({
        count,
        jobs: res?.jobs ?? [],
        timestamp: new Date(),
      });
      toast.success(`Zombie-Noop Guard: ${count} Jobs storniert`);
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => toast.error(`Cancel failed: ${e.message}`),
  });

  const finTotal = data?.finalization_stall?.total ?? 0;
  const nbTotal = data?.non_building_recoverable?.total ?? 0;

  return (
    <Card className="border-orange-500/40 bg-orange-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-orange-500" />
          Recovery Board
          {finTotal + nbTotal > 0 && (
            <Badge variant="destructive" className="ml-auto">
              {finTotal + nbTotal} recoverable
            </Badge>
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
              <Badge variant="outline" className="text-xs">
                {finTotal}
              </Badge>
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
                <div
                  key={p.package_id}
                  className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1 gap-1"
                >
                  <Link
                    to={`/admin/studio/${p.package_id}`}
                    className="font-mono truncate max-w-[100px] hover:text-primary transition-colors"
                  >
                    {p.package_id.slice(0, 8)}
                  </Link>
                  <span className="text-muted-foreground shrink-0">
                    {p.content_lessons}/{p.total_lessons} · {p.build_progress}%
                  </span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {p.finalize_status}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0 shrink-0"
                    disabled={retryStep.isPending}
                    onClick={() =>
                      retryStep.mutate({
                        packageId: p.package_id,
                        stepKey: "finalize_learning_content",
                      })
                    }
                    title="Finalize neu starten"
                  >
                    {retryStep.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
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
              <Badge variant="outline" className="text-xs">
                {nbTotal}
              </Badge>
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
                <div
                  key={p.package_id}
                  className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1 gap-1"
                >
                  <Link
                    to={`/admin/studio/${p.package_id}`}
                    className="font-mono truncate max-w-[100px] hover:text-primary transition-colors"
                  >
                    {p.package_id.slice(0, 8)}
                  </Link>
                  <span className="text-muted-foreground shrink-0">
                    {p.status} · {p.open_steps} open
                  </span>
                  {p.blocked_reason && (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-destructive truncate max-w-[80px] shrink-0"
                    >
                      {p.blocked_reason}
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 p-0 shrink-0"
                    disabled={retryStep.isPending}
                    onClick={() =>
                      retryStep.mutate({
                        packageId: p.package_id,
                        stepKey: p.first_open_step || "generate_learning_content",
                      })
                    }
                    title={`${p.first_open_step} neu starten`}
                  >
                    {retryStep.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* v3.0 Safety-Net Actions */}
        <div className="space-y-3 border-t pt-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-medium">Safety-Net Guards</span>
          </div>

          {/* Stale Processing Reset */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium">Stale Processing Reset</div>
                <div className="text-[10px] text-muted-foreground">
                  Setzt processing-Jobs mit Lock {">"} 5 min auf pending zurück. Idempotent.
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => resetStale.mutate()}
                disabled={resetStale.isPending}
                className="h-7 text-xs shrink-0"
              >
                {resetStale.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : null}
                Ausführen
              </Button>
            </div>
            <SafetyNetResultPanel label="Stale Processing" result={staleResult} />
          </div>

          {/* Zombie-Noop Guard */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium">Zombie-Noop Guard</div>
                <div className="text-[10px] text-muted-foreground">
                  Storniert Jobs, deren Step bereits done/skipped ist. Idempotent.
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => cancelZombies.mutate()}
                disabled={cancelZombies.isPending}
                className="h-7 text-xs shrink-0"
              >
                {cancelZombies.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : null}
                Ausführen
              </Button>
            </div>
            <SafetyNetResultPanel label="Zombie-Noop" result={zombieResult} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
