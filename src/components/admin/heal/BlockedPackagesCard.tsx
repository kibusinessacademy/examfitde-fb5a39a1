/**
 * BlockedPackagesCard
 * ───────────────────
 * Zentrale Übersicht aller `package_status='blocked'` Pakete mit:
 *   - Filter: Auto-ausführbar (actionability_class='auto') vs. Manuell (alles andere)
 *   - Pro-Paket Hard-Heal mit Status-Anzeige (idle | running | success | breaker | error)
 *   - Job-IDs nach Erfolg verlinkt zur Queue
 *   - Cooldown-Awareness: Buttons während 30-Min-Cooldown deaktiviert
 *   - "Hard-Heal für alle" CTA mit Pre-Check (überspringt nicht-blocked, respektiert Cooldown)
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Wand2,
  XCircle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { usePackageHealAction } from "@/lib/admin/heal/usePackageHealAction";
import {
  recommendHeal,
  buildHealReason,
  type HealSnapshot,
} from "@/lib/admin/heal/healService";
import { useHardHealCooldown } from "@/lib/admin/heal/useHardHealCooldown";
import {
  isHardHealOnCooldown,
  getHardHealCooldownRemaining,
  formatCooldown,
} from "@/lib/admin/heal/healCooldown";
import type { HealWorklistRow } from "./types";

type FilterMode = "auto" | "manual" | "all";

interface BlockedPackagesCardProps {
  /** Pfad zur Detailseite eines Pakets (für „Öffnen"-Link). */
  detailHrefBuilder?: (packageId: string) => string;
  /** Optionales Limit der angezeigten Pakete (Default 50). */
  limit?: number;
  /** Card-Größe; "compact" rendert weniger Padding/Schrift. */
  variant?: "default" | "compact";
}

interface RowState {
  status: "idle" | "running" | "success" | "breaker" | "error";
  message?: string;
  jobIds?: string[];
  attempts?: number;
}

async function fetchBlockedPackages(limit: number): Promise<HealWorklistRow[]> {
  const { data, error } = await (supabase as any)
    .from("v_admin_heal_cockpit")
    .select("*")
    .eq("package_status", "blocked")
    .order("urgency_score", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as HealWorklistRow[]).map((r) => ({
    ...r,
    deficiency_codes: r.deficiency_codes ?? [],
    open_jobs_by_type: r.open_jobs_by_type ?? {},
  }));
}

function snapshotFromRow(row: HealWorklistRow): HealSnapshot {
  return {
    packageId: row.package_id,
    track: row.track ?? null,
    releaseClass: (row.release_class ?? null) as HealSnapshot["releaseClass"],
    blockReason: row.blocked_reason ?? null,
    hardFailReasons: row.recommended_action_reasons ?? [],
    hasActiveJobs: (row.processing_jobs ?? 0) + (row.pending_jobs ?? 0) > 0,
    isStuck: (row.exhausted_steps ?? 0) > 0 || (row.blocked_steps ?? 0) > 0,
    currentQueuedStep: null,
  };
}

function CooldownBadge({ packageId }: { packageId: string }) {
  const { isOnCooldown, label } = useHardHealCooldown(packageId);
  if (!isOnCooldown) return null;
  return (
    <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600">
      <Clock className="h-3 w-3" />
      Cooldown {label}
    </Badge>
  );
}

function StatusBadge({ state }: { state: RowState }) {
  if (state.status === "idle") return null;
  if (state.status === "running") {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        läuft …
      </Badge>
    );
  }
  if (state.status === "success") {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        OK{state.attempts && state.attempts > 1 ? ` (${state.attempts}×)` : ""}
      </Badge>
    );
  }
  if (state.status === "breaker") {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/50 text-destructive">
        <ShieldAlert className="h-3 w-3" />
        Manuelles Review
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
      <XCircle className="h-3 w-3" />
      Fehler
    </Badge>
  );
}

export function BlockedPackagesCard({
  detailHrefBuilder,
  limit = 50,
  variant = "default",
}: BlockedPackagesCardProps) {
  const [filter, setFilter] = useState<FilterMode>("auto");
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [bulkSummary, setBulkSummary] = useState<{
    attempted: number;
    skippedNotBlocked: number;
    skippedCooldown: number;
    success: number;
    breaker: number;
    error: number;
  } | null>(null);

  const heal = usePackageHealAction();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["blocked-packages-card", limit],
    queryFn: () => fetchBlockedPackages(limit),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const all = data ?? [];
  const autoRows = useMemo(
    () => all.filter((r) => r.actionability_class === "auto"),
    [all],
  );
  const manualRows = useMemo(
    () => all.filter((r) => r.actionability_class !== "auto"),
    [all],
  );
  const visible = filter === "auto" ? autoRows : filter === "manual" ? manualRows : all;

  async function runOne(row: HealWorklistRow): Promise<RowState["status"]> {
    // Cooldown-Guard auch im Code (UX disable + Server-Cooldown sind die anderen Layers).
    if (isHardHealOnCooldown(row.package_id)) {
      setRowState((s) => ({
        ...s,
        [row.package_id]: {
          status: "error",
          message: `Cooldown aktiv (${formatCooldown(getHardHealCooldownRemaining(row.package_id))})`,
        },
      }));
      return "error";
    }

    setRowState((s) => ({ ...s, [row.package_id]: { status: "running" } }));
    const snap = snapshotFromRow(row);
    const rec = recommendHeal(snap);
    try {
      const res = await heal.mutateAsync({
        packageId: row.package_id,
        mode: "hard",
        resetFromStep: rec.resetFromStep,
        reason: buildHealReason("manual_hard_heal", rec.resetFromStep),
        snapshot: snap,
        enqueuePlan: rec.enqueuePlan,
        operatorNote: "blocked_packages_card_bulk",
      });
      setRowState((s) => ({
        ...s,
        [row.package_id]: {
          status: "success",
          jobIds: res.jobIds,
          attempts: res.attempts,
          message: `${res.mode} heal · ${res.jobIds?.length ?? 0} jobs`,
        },
      }));
      return "success";
    } catch (err: any) {
      const breaker = !!err?.breaker;
      setRowState((s) => ({
        ...s,
        [row.package_id]: {
          status: breaker ? "breaker" : "error",
          message: err?.message ?? String(err),
          jobIds: err?.jobIds,
        },
      }));
      return breaker ? "breaker" : "error";
    }
  }

  async function runAll() {
    setBulkSummary(null);
    // Pre-Check: nur wirklich blocked Pakete (live aus DB), Cooldown ausschließen.
    const fresh = await fetchBlockedPackages(limit);
    const freshIds = new Set(fresh.map((r) => r.package_id));

    const candidates = visible.filter((r) => freshIds.has(r.package_id));
    const skippedNotBlocked = visible.length - candidates.length;

    let skippedCooldown = 0;
    let success = 0;
    let breaker = 0;
    let error = 0;
    const toRun: HealWorklistRow[] = [];
    for (const c of candidates) {
      if (isHardHealOnCooldown(c.package_id)) {
        skippedCooldown++;
        setRowState((s) => ({
          ...s,
          [c.package_id]: {
            status: "error",
            message: `Cooldown aktiv (${formatCooldown(getHardHealCooldownRemaining(c.package_id))})`,
          },
        }));
        continue;
      }
      toRun.push(c);
    }

    // Sequenziell, damit Cooldown/Lock-Konflikte serverseitig nicht eskalieren.
    for (const row of toRun) {
      const r = await runOne(row);
      if (r === "success") success++;
      else if (r === "breaker") breaker++;
      else error++;
    }

    setBulkSummary({
      attempted: toRun.length,
      skippedNotBlocked,
      skippedCooldown,
      success,
      breaker,
      error,
    });
    refetch();
  }

  const compact = variant === "compact";

  return (
    <Card>
      <CardHeader className={compact ? "pb-2" : "pb-3"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            Blockierte Pakete
            {data && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {all.length} gesamt · {autoRows.length} auto · {manualRows.length} manuell
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterMode)}>
              <TabsList className="h-8">
                <TabsTrigger value="auto" className="h-7 px-2 text-xs">
                  Auto ({autoRows.length})
                </TabsTrigger>
                <TabsTrigger value="manual" className="h-7 px-2 text-xs">
                  Manuell ({manualRows.length})
                </TabsTrigger>
                <TabsTrigger value="all" className="h-7 px-2 text-xs">
                  Alle ({all.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              size="sm"
              variant="default"
              onClick={runAll}
              disabled={
                heal.isPending ||
                isFetching ||
                visible.length === 0
              }
              title="Hard-Heal für alle aktuell sichtbaren blockierten Pakete (Pre-Check + Cooldown-Skip)"
            >
              {heal.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Hard-Heal für alle ({visible.length})
            </Button>
          </div>
        </div>

        <Alert className="mt-3 border-amber-500/30 bg-amber-500/5 py-2">
          <Clock className="h-3.5 w-3.5 text-amber-600" />
          <AlertTitle className="text-xs font-medium">30-Minuten-Cooldown nach Hard-Heal</AlertTitle>
          <AlertDescription className="text-[11px] text-muted-foreground">
            Nach jedem erfolgreichen Hard-Heal sperrt der Server-Guard das Paket für 30 Minuten,
            damit ein laufender Repair nicht parallel erneut gestartet wird. Buttons werden während
            dieser Zeit automatisch deaktiviert.
          </AlertDescription>
        </Alert>

        {bulkSummary && (
          <Alert
            className={`mt-2 py-2 ${
              bulkSummary.breaker > 0 || bulkSummary.error > 0
                ? "border-destructive/30 bg-destructive/5"
                : "border-emerald-500/30 bg-emerald-500/5"
            }`}
          >
            {bulkSummary.breaker > 0 || bulkSummary.error > 0 ? (
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            )}
            <AlertTitle className="text-xs font-medium">Bulk-Heal abgeschlossen</AlertTitle>
            <AlertDescription className="text-[11px] text-muted-foreground">
              {bulkSummary.attempted} versucht · {bulkSummary.success} OK ·{" "}
              {bulkSummary.breaker} Breaker · {bulkSummary.error} Fehler ·{" "}
              {bulkSummary.skippedCooldown} Cooldown ·{" "}
              {bulkSummary.skippedNotBlocked} nicht mehr blocked
            </AlertDescription>
          </Alert>
        )}
      </CardHeader>

      <CardContent className={compact ? "p-2" : "p-3"}>
        {error ? (
          <div className="p-3 text-sm text-destructive">
            Fehler beim Laden: {(error as Error).message}
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <ShieldCheck className="h-8 w-8 text-emerald-500" />
            <div className="text-sm font-medium">Keine blockierten Pakete in dieser Ansicht</div>
            <div className="text-xs text-muted-foreground">
              {filter === "auto"
                ? "Es gibt aktuell keine auto-heilbaren blockierten Pakete."
                : filter === "manual"
                  ? "Keine Pakete erfordern manuelles Eingreifen."
                  : "System ist sauber."}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((row) => {
              const state = rowState[row.package_id] ?? { status: "idle" as const };
              return (
                <BlockedRow
                  key={row.package_id}
                  row={row}
                  state={state}
                  busy={heal.isPending}
                  detailHrefBuilder={detailHrefBuilder}
                  onHeal={() => runOne(row)}
                />
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BlockedRow({
  row,
  state,
  busy,
  detailHrefBuilder,
  onHeal,
}: {
  row: HealWorklistRow;
  state: RowState;
  busy: boolean;
  detailHrefBuilder?: (id: string) => string;
  onHeal: () => void;
}) {
  const cooldown = useHardHealCooldown(row.package_id);
  const disabled =
    busy ||
    state.status === "running" ||
    cooldown.isOnCooldown;

  return (
    <li className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">
            {row.package_title ?? row.package_id.slice(0, 8)}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {row.actionability_class}
          </Badge>
          <Badge variant="outline" className="text-[10px] text-destructive">
            urg {row.urgency_score}
          </Badge>
          <CooldownBadge packageId={row.package_id} />
          <StatusBadge state={state} />
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {row.course_title ?? row.curriculum_id ?? row.package_id}
          {row.blocked_reason ? ` · ${row.blocked_reason}` : ""}
        </div>
        {state.message && state.status !== "success" && (
          <div
            className={`mt-1 text-[11px] ${
              state.status === "breaker" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {state.message}
          </div>
        )}
        {state.jobIds && state.jobIds.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
            <span className="text-muted-foreground">Jobs:</span>
            {state.jobIds.slice(0, 4).map((jid) => (
              <Link
                key={jid}
                to={`/admin/v2/queue?job_id=${jid}`}
                className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted/80"
                target="_blank"
                rel="noreferrer"
              >
                {jid.slice(0, 8)}
                <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            ))}
            {state.jobIds.length > 4 && (
              <span className="text-muted-foreground">+{state.jobIds.length - 4}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 sm:shrink-0">
        {detailHrefBuilder && (
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link to={detailHrefBuilder(row.package_id)}>Öffnen</Link>
          </Button>
        )}
        <Button
          size="sm"
          variant={cooldown.isOnCooldown ? "outline" : "default"}
          onClick={onHeal}
          disabled={disabled}
          title={
            cooldown.isOnCooldown
              ? `Cooldown aktiv — wieder verfügbar in ${cooldown.label}`
              : "Hard-Heal für dieses Paket ausführen"
          }
          className="h-7 px-2.5 text-xs"
        >
          {state.status === "running" ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : cooldown.isOnCooldown ? (
            <Clock className="mr-1 h-3 w-3" />
          ) : (
            <Wand2 className="mr-1 h-3 w-3" />
          )}
          {cooldown.isOnCooldown ? `Cooldown ${cooldown.label}` : "Hard-Heal"}
        </Button>
      </div>
    </li>
  );
}

export default BlockedPackagesCard;
