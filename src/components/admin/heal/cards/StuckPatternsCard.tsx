/**
 * StuckPatternsCard — Systemic Stuck-Patterns Dashboard + Bulk-/Per-Package Heal
 *
 * Drei Patterns:
 *   • HIDDEN_DRAFTS         — ≥10 promotbare Draft-Fragen (Coverage-Lücke)
 *   • QUEUED_NO_JOBS        — Status=queued + queued steps + 0 active jobs (P0A-Stau)
 *   • REENTRY_GUARD_LOCKED  — manual_heal_cooldown_until > now()
 *
 * Aktionen:
 *   1. Bulk-Promote queued→building (mit WIP-Cap-Guardrail + Skip-Reasons)
 *   2. Per-Paket Atomic-Trigger Nudge
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Activity, AlertTriangle, Eye, Play, RefreshCw, Zap, Layers, Repeat, Square, CheckCircle2 } from "lucide-react";

type PatternRow = {
  pattern_key: "HIDDEN_DRAFTS" | "QUEUED_NO_JOBS" | "REENTRY_GUARD_LOCKED";
  pattern_label: string;
  pattern_help: string;
  package_count: number;
  detail_count: number;
  package_ids: string[] | null;
};

type PerPackageRow = {
  package_id: string;
  title: string;
  track: string | null;
  package_status: string;
  curriculum_id: string | null;
  priority: number;
  last_progress_at: string | null;
  manual_heal_cooldown_until: string | null;
  draft_count: number;
  queued_steps: number;
  active_jobs: number;
  patterns: string[];
  heal_priority_score: number;
};

const PATTERN_TONE: Record<PatternRow["pattern_key"], string> = {
  HIDDEN_DRAFTS: "border-destructive/40 bg-destructive/5",
  QUEUED_NO_JOBS: "border-warning/40 bg-warning/5",
  REENTRY_GUARD_LOCKED: "border-muted-foreground/40 bg-muted/20",
};

export function StuckPatternsCard() {
  const qc = useQueryClient();
  const [trackFilter, setTrackFilter] = useState<string>("");
  const [patternFilter, setPatternFilter] = useState<PatternRow["pattern_key"] | "ALL">("ALL");
  const [bulkPreview, setBulkPreview] = useState<unknown>(null);
  const [maxPackages, setMaxPackages] = useState<number>(10);
  const [wipCap, setWipCap] = useState<number>(65);

  // ── Auto-Loop State ─────────────────────────────────────────────
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopIntervalSec, setLoopIntervalSec] = useState<number>(120); // 2 min
  const [loopMaxAttempts, setLoopMaxAttempts] = useState<number>(20);
  const [loopAttempts, setLoopAttempts] = useState<number>(0);
  const [loopPromotedTotal, setLoopPromotedTotal] = useState<number>(0);
  const [loopLastRunAt, setLoopLastRunAt] = useState<number | null>(null);
  const [loopNextRunAt, setLoopNextRunAt] = useState<number | null>(null);
  const [loopStopReason, setLoopStopReason] = useState<string | null>(null);
  const [loopBaselineQueued, setLoopBaselineQueued] = useState<number | null>(null);
  const noProgressStreak = useRef(0);
  const lastQueuedSeen = useRef<number | null>(null);
  const [, forceTick] = useState(0); // re-render for countdown

  const overview = useQuery({
    queryKey: ["stuck-patterns-overview"],
    queryFn: async (): Promise<PatternRow[]> => {
      const { data, error } = await supabase
        .from("v_admin_stuck_patterns_overview" as never)
        .select("*");
      if (error) throw error;
      return (data as unknown as PatternRow[]) ?? [];
    },
    refetchInterval: 30_000,
  });

  const perPackage = useQuery({
    queryKey: ["stuck-patterns-per-package"],
    queryFn: async (): Promise<PerPackageRow[]> => {
      const { data, error } = await supabase
        .from("v_admin_stuck_patterns_by_track" as never)
        .select("*")
        .order("heal_priority_score", { ascending: false } as never)
        .limit(200);
      if (error) throw error;
      return (data as unknown as PerPackageRow[]) ?? [];
    },
    refetchInterval: 30_000,
  });

  const bulkPromote = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const { data, error } = await supabase.rpc("admin_bulk_promote_queued_to_building" as never, {
        p_dry_run: dryRun,
        p_max_packages: maxPackages,
        p_wip_cap: wipCap,
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: (data, dryRun) => {
      if (dryRun) {
        setBulkPreview(data);
        toast({ title: "Dry-Run abgeschlossen", description: "Kandidaten ermittelt — Execute aktiv." });
      } else {
        const r = data as { promoted?: number; nudged?: number; processed?: number };
        toast({
          title: "Bulk-Promote abgeschlossen",
          description: `${r.promoted ?? 0} promoted · ${r.nudged ?? 0} step-nudges · ${r.processed ?? 0} processed`,
        });
        setBulkPreview(null);
        if (loopRunning) {
          setLoopPromotedTotal((t) => t + (r.promoted ?? 0));
        }
        qc.invalidateQueries({ queryKey: ["stuck-patterns-overview"] });
        qc.invalidateQueries({ queryKey: ["stuck-patterns-per-package"] });
      }
    },
    onError: (e: Error) => {
      if (loopRunning) {
        setLoopRunning(false);
        setLoopStopReason(`RPC-Fehler: ${e.message}`);
      }
      toast({ title: "Bulk-Heal fehlgeschlagen", description: e.message, variant: "destructive" });
    },
  });

  // ── Auto-Loop Effect ────────────────────────────────────────────
  useEffect(() => {
    if (!loopRunning) return;
    const tick = setInterval(() => {
      forceTick((n) => n + 1);
      const now = Date.now();
      if (loopNextRunAt != null && now >= loopNextRunAt && !bulkPromote.isPending) {
        const ovRows = (overview.data ?? []) as PatternRow[];
        const queuedNow = ovRows.find((r) => r.pattern_key === "QUEUED_NO_JOBS")?.package_count ?? 0;

        if (queuedNow === 0) {
          setLoopRunning(false);
          setLoopStopReason("Ziel erreicht: 0 Pakete in QUEUED_NO_JOBS.");
          return;
        }
        if (loopAttempts >= loopMaxAttempts) {
          setLoopRunning(false);
          setLoopStopReason(`Max-Versuche erreicht (${loopMaxAttempts}).`);
          return;
        }
        if (lastQueuedSeen.current != null && queuedNow >= lastQueuedSeen.current) {
          noProgressStreak.current += 1;
        } else {
          noProgressStreak.current = 0;
        }
        if (noProgressStreak.current >= 2) {
          setLoopRunning(false);
          setLoopStopReason("Kein Fortschritt in 2 Runden — vermutlich WIP-Cap oder Worker-Block.");
          return;
        }
        lastQueuedSeen.current = queuedNow;

        setLoopAttempts((a) => a + 1);
        setLoopLastRunAt(now);
        setLoopNextRunAt(now + loopIntervalSec * 1000);
        bulkPromote.mutate(false);
      }
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopRunning, loopNextRunAt, loopAttempts, loopMaxAttempts, loopIntervalSec, overview.data]);

  function startLoop() {
    const ovRows = (overview.data ?? []) as PatternRow[];
    const baseline = ovRows.find((r) => r.pattern_key === "QUEUED_NO_JOBS")?.package_count ?? 0;
    if (baseline === 0) {
      toast({ title: "Nichts zu tun", description: "QUEUED_NO_JOBS ist bereits 0." });
      return;
    }
    setLoopBaselineQueued(baseline);
    setLoopAttempts(0);
    setLoopPromotedTotal(0);
    setLoopStopReason(null);
    lastQueuedSeen.current = baseline;
    noProgressStreak.current = 0;
    const now = Date.now();
    setLoopLastRunAt(null);
    setLoopNextRunAt(now);
    setLoopRunning(true);
    toast({ title: "Auto-Loop gestartet", description: `Baseline: ${baseline} pkg · alle ${loopIntervalSec}s · max ${loopMaxAttempts}×` });
  }

  function stopLoop() {
    setLoopRunning(false);
    setLoopStopReason("Manuell gestoppt.");
  }

  const nudge = useMutation({
    mutationFn: async (vars: { packageId: string; dryRun: boolean }) => {
      const { data, error } = await supabase.rpc("admin_nudge_atomic_trigger" as never, {
        p_package_id: vars.packageId,
        p_dry_run: vars.dryRun,
      } as never);
      if (error) throw error;
      return data as { ok?: boolean; skip_reason?: string; promoted_to_building?: boolean; nudged_step_key?: string };
    },
    onSuccess: (data, vars) => {
      if (data.skip_reason) {
        toast({
          title: `Übersprungen: ${data.skip_reason}`,
          description: vars.dryRun ? "Dry-Run" : "Keine Aktion ausgeführt.",
        });
      } else if (vars.dryRun) {
        toast({
          title: "Dry-Run OK",
          description: `Würde Step ${data.nudged_step_key ?? "?"} nudgen${data.promoted_to_building ? " + promote" : ""}`,
        });
      } else {
        toast({
          title: "Atomic-Trigger angestoßen",
          description: `Step ${data.nudged_step_key ?? "?"} nudged${data.promoted_to_building ? " + promoted to building" : ""}`,
        });
        qc.invalidateQueries({ queryKey: ["stuck-patterns-overview"] });
        qc.invalidateQueries({ queryKey: ["stuck-patterns-per-package"] });
      }
    },
    onError: (e: Error) => toast({ title: "Nudge fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    const rows = perPackage.data ?? [];
    return rows.filter((r) => {
      if (patternFilter !== "ALL" && !r.patterns.includes(patternFilter)) return false;
      if (trackFilter && !(r.track ?? "").toLowerCase().includes(trackFilter.toLowerCase()) &&
          !(r.title ?? "").toLowerCase().includes(trackFilter.toLowerCase())) return false;
      return true;
    });
  }, [perPackage.data, patternFilter, trackFilter]);

  const ovRows = overview.data ?? [];
  const totalAffected = ovRows.reduce((s, r) => s + (r.package_count ?? 0), 0);

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          Stuck-Patterns Dashboard
          <Badge variant={totalAffected > 0 ? "destructive" : "secondary"} className="ml-auto tabular-nums">
            {totalAffected} Pakete
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pattern Overview */}
        {overview.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {(["HIDDEN_DRAFTS", "QUEUED_NO_JOBS", "REENTRY_GUARD_LOCKED"] as const).map((key) => {
              const row = ovRows.find((r) => r.pattern_key === key);
              const isActive = patternFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setPatternFilter(isActive ? "ALL" : key)}
                  className={`text-left rounded-md border p-3 transition ${
                    row && row.package_count > 0 ? PATTERN_TONE[key] : "border-border bg-muted/10"
                  } ${isActive ? "ring-2 ring-primary" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-semibold">{row?.pattern_label ?? key}</div>
                    <Badge variant="outline" className="tabular-nums text-[10px]">
                      {row?.package_count ?? 0} pkg
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-tight">
                    {row?.pattern_help ?? "—"}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Bulk-Heal Action */}
        <div className="rounded-md border border-warning/30 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-warning" />
            <div className="text-xs font-semibold">
              Auto Bulk-Heal: queued → building (mit WIP-Cap)
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Hebt queued-Pakete in kleinen Chargen auf <code>building</code> an + nudged ersten queued Step.
            Skipt Pakete ohne queued Steps, mit aktiven Jobs, ohne Curriculum oder bei WIP-Cap.
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground block">Max Pakete</label>
              <Input
                type="number"
                min={1}
                max={50}
                value={maxPackages}
                onChange={(e) => setMaxPackages(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
                className="h-8 w-20 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block">WIP-Cap</label>
              <Input
                type="number"
                min={1}
                max={200}
                value={wipCap}
                onChange={(e) => setWipCap(Math.max(1, Math.min(200, Number(e.target.value) || 65)))}
                className="h-8 w-20 text-xs"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => bulkPromote.mutate(true)}
              disabled={bulkPromote.isPending}
            >
              <Eye className="h-3 w-3 mr-1" /> Dry-Run
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => bulkPromote.mutate(false)}
              disabled={!bulkPreview || bulkPromote.isPending}
            >
              <Play className="h-3 w-3 mr-1" /> Execute
            </Button>
          </div>
          {bulkPreview != null ? (
            <pre className="text-[10px] bg-muted/30 rounded p-2 max-h-40 overflow-auto">
              {JSON.stringify(bulkPreview, null, 2)}
            </pre>
          ) : null}
        </div>

        {/* Per-Package List */}
        <div className="rounded-md border border-border p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-xs font-semibold">Priorisierte Pakete</div>
            <Badge variant="outline" className="tabular-nums text-[10px]">
              {filtered.length} / {(perPackage.data ?? []).length}
            </Badge>
            <Input
              placeholder="Filter Track / Titel…"
              value={trackFilter}
              onChange={(e) => setTrackFilter(e.target.value)}
              className="h-7 w-48 text-xs ml-auto"
            />
            {patternFilter !== "ALL" ? (
              <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setPatternFilter("ALL")}>
                Filter ×
              </Button>
            ) : null}
          </div>
          {perPackage.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : filtered.length === 0 ? (
            <Alert>
              <AlertDescription className="text-[11px]">
                ✓ Keine Pakete im aktuellen Filter — System sauber.
              </AlertDescription>
            </Alert>
          ) : (
            <ScrollArea className="h-72 pr-2">
              <div className="space-y-1.5">
                {filtered.map((r) => (
                  <PackageRow key={r.package_id} row={r} onNudge={(dryRun) => nudge.mutate({ packageId: r.package_id, dryRun })} busy={nudge.isPending} />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="flex items-center justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["stuck-patterns-overview"] });
              qc.invalidateQueries({ queryKey: ["stuck-patterns-per-package"] });
            }}
          >
            <RefreshCw className="h-3 w-3 mr-1" /> Aktualisieren
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PackageRow({
  row,
  onNudge,
  busy,
}: {
  row: PerPackageRow;
  onNudge: (dryRun: boolean) => void;
  busy: boolean;
}) {
  return (
    <div className="rounded border border-border bg-muted/10 p-2 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="text-[10px] tabular-nums">
          P{row.heal_priority_score}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {row.package_status}
        </Badge>
        {row.track ? (
          <Badge variant="outline" className="text-[10px] font-mono">
            {row.track}
          </Badge>
        ) : null}
        <div className="text-xs font-medium truncate flex-1">{row.title}</div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px]"
          disabled={busy}
          onClick={() => onNudge(true)}
        >
          <Eye className="h-3 w-3 mr-1" /> Dry
        </Button>
        <Button
          size="sm"
          variant="default"
          className="h-7 text-[10px]"
          disabled={busy}
          onClick={() => onNudge(false)}
        >
          <Zap className="h-3 w-3 mr-1" /> Nudge
        </Button>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums flex-wrap">
        <span>drafts: {row.draft_count}</span>
        <span>queued steps: {row.queued_steps}</span>
        <span>active jobs: {row.active_jobs}</span>
        {row.patterns.map((p) => (
          <Badge key={p} variant="outline" className="text-[9px] font-mono">
            {p}
          </Badge>
        ))}
        {row.manual_heal_cooldown_until ? (
          <span className="text-warning">
            <AlertTriangle className="h-3 w-3 inline mr-0.5" />
            cooldown bis {new Date(row.manual_heal_cooldown_until).toLocaleString()}
          </span>
        ) : null}
      </div>
    </div>
  );
}
