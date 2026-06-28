/**
 * HealFunctionLauncher
 *
 * Kompakter Tile-Grid mit allen wichtigsten Heal-Funktionen.
 * Wird ganz oben in /admin/heal angezeigt — One-Click-Run mit
 * Confirm-Dialog, Last-Run-Timestamp und Status-Badge.
 *
 * Backend-Hook-Up:
 *  - admin-ops-actions Edge Function (runAdminOpsAction)
 *  - direkte RPCs (admin_reap_stale_processing_now, …)
 *  - eigene Edge Functions (sellable-recovery-batch, stripe-sync-reaper)
 *
 * Last-Run-Lookup: einmalige Abfrage auf auto_heal_log,
 *                  Auto-Refetch alle 30 s.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { runAdminOpsAction, type AdminOpsAction } from "@/integrations/supabase/admin-ops-actions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Activity, AlertTriangle, Ban, CheckCircle2, CircleDot, Coins,
  Eraser, FileWarning, Flame, GitBranch, Hammer, Loader2, RefreshCw,
  ShieldAlert, Sparkles, Trash2, Wand2, Wrench, Zap,
} from "lucide-react";
import { toast } from "sonner";

// ─── Spec ───────────────────────────────────────────────────────────────────

type Tone = "default" | "destructive" | "warning";
type LauncherSpec = {
  id: string;
  group: "reaper" | "bulk" | "package" | "sellable" | "cleanup";
  label: string;
  hint: string;
  icon: typeof Zap;
  tone: Tone;
  /** action_type-Werte in auto_heal_log, die diese Operation auslöst */
  audit_action_types: string[];
  confirm: string;
  run: () => Promise<unknown>;
};

const GROUPS: Record<LauncherSpec["group"], { title: string; icon: typeof Zap }> = {
  reaper:   { title: "Lane-Reaper",     icon: Zap },
  bulk:     { title: "Bulk-Heal",       icon: Hammer },
  package:  { title: "Pakete",          icon: Wrench },
  sellable: { title: "Sellable & Stripe", icon: Coins },
  cleanup:  { title: "Cleanup",         icon: Eraser },
};

function ops(action: AdminOpsAction, payload: Record<string, unknown> = {}) {
  return () => runAdminOpsAction(action, payload);
}

async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw error;
  return data;
}

async function edge(fnName: string, body: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke(fnName, {
    body,
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (error) throw error;
  return data;
}

const SPECS: LauncherSpec[] = [
  // ── Reaper ───────────────────────────────────────────────────────────────
  {
    id: "reap_control",
    group: "reaper",
    label: "Reap Control-Lane",
    hint: "Cancelt stale processing-Jobs in Control-Lane (>5min)",
    icon: Zap,
    tone: "destructive",
    audit_action_types: ["reap_stale_processing", "lane_reap"],
    confirm: "Bis zu 100 processing-Jobs in Control-Lane werden abgebrochen oder requeued.",
    run: () => rpc("admin_reap_stale_processing_now", {
      p_max_age_seconds: 300, p_max_cancels: 100, p_lane: "control",
    }),
  },
  {
    id: "reap_all",
    group: "reaper",
    label: "Reap All Lanes",
    hint: "Cancelt stale processing-Jobs in ALLEN Lanes",
    icon: Flame,
    tone: "destructive",
    audit_action_types: ["reap_stale_processing", "lane_reap"],
    confirm: "Bis zu 100 stale processing-Jobs aller Lanes werden abgebrochen oder requeued.",
    run: () => rpc("admin_reap_stale_processing_now", {
      p_max_age_seconds: 300, p_max_cancels: 100, p_lane: null,
    }),
  },
  {
    id: "reset_stale",
    group: "reaper",
    label: "Reset Stale Processing",
    hint: "Setzt nicht-leasebare processing-Jobs zurück auf pending",
    icon: RefreshCw,
    tone: "warning",
    audit_action_types: ["reset_stale_processing"],
    confirm: "Setzt processing-Jobs ohne aktives Lease auf pending zurück.",
    run: ops("reset_stale_processing"),
  },
  {
    id: "cancel_zombies",
    group: "reaper",
    label: "Cancel Zombie No-Op",
    hint: "Bricht Jobs ohne Effekt + lang laufende noop-Loops ab",
    icon: Ban,
    tone: "warning",
    audit_action_types: ["cancel_zombie_noop_jobs"],
    confirm: "Bricht alle als zombie/no-op klassifizierten Jobs ab.",
    run: ops("cancel_zombie_noop_jobs"),
  },

  // ── Bulk ─────────────────────────────────────────────────────────────────
  {
    id: "heal_finalization",
    group: "bulk",
    label: "Heal Finalization Stall",
    hint: "Beendet Pakete, die im finalization-Step hängen (Council OK)",
    icon: CheckCircle2,
    tone: "default",
    audit_action_types: ["heal_finalization_stall"],
    confirm: "Schiebt bis zu 20 Pakete aus dem Finalization-Stall.",
    run: () => runAdminOpsAction("heal_finalization_stall", { limit: 20 }),
  },
  {
    id: "heal_non_building",
    group: "bulk",
    label: "Heal Non-Building",
    hint: "Re-enqueued Pakete im status='approved', die nicht weiterbauen",
    icon: Hammer,
    tone: "default",
    audit_action_types: ["heal_non_building"],
    confirm: "Bis zu 20 stehengebliebene Pakete werden re-enqueued.",
    run: () => runAdminOpsAction("heal_non_building", { limit: 20 }),
  },
  {
    id: "bulk_promote_queued",
    group: "bulk",
    label: "Bulk Promote Queued",
    hint: "Promoted queued→building (WIP-Cap 18)",
    icon: Sparkles,
    tone: "default",
    audit_action_types: ["bulk_promote_queued_to_building"],
    confirm: "Promoted bis zu 18 queued-Pakete in den building-Status (WIP-Cap).",
    run: () => rpc("admin_bulk_promote_queued_to_building", {}),
  },

  // ── Package ──────────────────────────────────────────────────────────────
  {
    id: "force_publish_release_ok",
    group: "package",
    label: "Force Publish Release-OK",
    hint: "Veröffentlicht Pakete mit release_class='release_ok' sofort",
    icon: GitBranch,
    tone: "warning",
    audit_action_types: ["force_publish_release_ok"],
    confirm: "Veröffentlicht alle Pakete mit release_class=release_ok – Audit-pflichtig.",
    run: () => runAdminOpsAction("bulk_heal_by_class", { release_class: "release_ok" }),
  },
  {
    id: "reconcile_tail",
    group: "package",
    label: "Reconcile Pipeline-Tail",
    hint: "Fixt approved-Pakete mit unfertigem Tail (SEO, Bridges, etc.)",
    icon: Wrench,
    tone: "default",
    audit_action_types: ["reconcile_pipeline_tail"],
    confirm: "Stößt Tail-Reconcile für alle release_warn-Pakete an.",
    run: () => runAdminOpsAction("bulk_heal_by_class", { release_class: "release_warn" }),
  },

  // ── Sellable / Stripe ────────────────────────────────────────────────────
  {
    id: "sellable_recovery_dry",
    group: "sellable",
    label: "Sellable Recovery (Dry-Run)",
    hint: "Diagnose: welche Pakete blockieren v_public_sellable_courses?",
    icon: ShieldAlert,
    tone: "default",
    audit_action_types: ["sellable_recovery_batch"],
    confirm: "Führt Sellable-Recovery im Dry-Run aus (kein Schreibzugriff).",
    run: () => edge("sellable-recovery-batch", { dry_run: true, lanes: ["A", "B", "C"] }),
  },
  {
    id: "sellable_recovery_exec",
    group: "sellable",
    label: "Sellable Recovery (Execute)",
    hint: "Heilt Sellable-Drift in 3 Lanes (Readiness / Demote / Bridge)",
    icon: CircleDot,
    tone: "warning",
    audit_action_types: ["sellable_recovery_batch"],
    confirm: "Führt alle 3 Sellable-Recovery-Lanes scharf aus (Audit-pflichtig).",
    run: () => edge("sellable-recovery-batch", { dry_run: false, lanes: ["A", "B", "C"] }),
  },
  {
    id: "stripe_sync_reaper",
    group: "sellable",
    label: "Stripe Sync Reaper",
    hint: "Synct Produkte ohne stripe_product_id selbstheilend nach",
    icon: Coins,
    tone: "default",
    audit_action_types: ["stripe_sync_reaper", "stripe_sync_required"],
    confirm: "Triggert Stripe-Sync-Reaper für alle Produkte mit sync_required.",
    run: () => edge("stripe-sync-reaper", {}),
  },

  // ── Cleanup ──────────────────────────────────────────────────────────────
  {
    id: "ghost_completions",
    group: "cleanup",
    label: "Heal Ghost Completions",
    hint: "Markiert verwaiste completed-Jobs ohne Folge-Step",
    icon: FileWarning,
    tone: "default",
    audit_action_types: ["heal_ghost_completions"],
    confirm: "Repariert ghost-completions (idempotent).",
    run: ops("heal_ghost_completions"),
  },
  {
    id: "purge_completed",
    group: "cleanup",
    label: "Purge Completed Jobs",
    hint: "Räumt completed-Jobs >7 Tage aus job_queue auf",
    icon: Trash2,
    tone: "warning",
    audit_action_types: ["purge_completed_jobs"],
    confirm: "Löscht completed-Jobs > 7 Tage. Audit bleibt erhalten.",
    run: ops("purge_completed_jobs"),
  },
  {
    id: "zombie_sweep",
    group: "cleanup",
    label: "Zombie Sweep",
    hint: "Findet & cleant orphan locks + abgelaufene Leases",
    icon: AlertTriangle,
    tone: "warning",
    audit_action_types: ["zombie_sweep"],
    confirm: "Räumt orphan locks und abgelaufene Leases auf.",
    run: ops("zombie_sweep"),
  },
  {
    id: "full_queue_reset",
    group: "cleanup",
    label: "Full Queue Reset",
    hint: "⚠️ Hard-Reset: alle processing → pending (Notbremse)",
    icon: Wand2,
    tone: "destructive",
    audit_action_types: ["full_queue_reset"],
    confirm: "NOTBREMSE: setzt sämtliche processing-Jobs auf pending zurück. Nur in Stillstand verwenden.",
    run: ops("full_queue_reset"),
  },
];

// ─── Last-Run lookup ────────────────────────────────────────────────────────

type LastRun = { created_at: string; status: string | null };

function useLastRuns() {
  return useQuery({
    queryKey: ["heal-launcher-last-runs"],
    refetchInterval: 30_000,
    queryFn: async (): Promise<Record<string, LastRun>> => {
      const allTypes = Array.from(
        new Set(SPECS.flatMap((s) => s.audit_action_types)),
      );
      const { data, error } = await supabase
        .from("auto_heal_log" as any)
        .select("action_type, status, created_at")
        .in("action_type", allTypes)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) return {};
      const map: Record<string, LastRun> = {};
      for (const row of (data as any[]) ?? []) {
        if (!map[row.action_type]) {
          map[row.action_type] = { created_at: row.created_at, status: row.status };
        }
      }
      // Resolve per spec → erstmal-treffender action_type
      const out: Record<string, LastRun> = {};
      for (const s of SPECS) {
        for (const t of s.audit_action_types) {
          if (map[t]) { out[s.id] = map[t]; break; }
        }
      }
      return out;
    },
  });
}

function formatAgo(iso: string): string {
  const dt = new Date(iso).getTime();
  const diff = Date.now() - dt;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "jetzt";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d`;
}

// ─── Tile ───────────────────────────────────────────────────────────────────

function Tile({ spec, last }: { spec: LauncherSpec; last?: LastRun }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const mut = useMutation({
    mutationFn: async () => spec.run(),
    onSuccess: (res: any) => {
      const summary =
        res && typeof res === "object"
          ? Object.entries(res)
              .filter(([k]) => ["ok", "succeeded", "failed", "requeued", "total", "processed"].includes(k))
              .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
              .join(" · ")
          : "ok";
      toast.success(`${spec.label} → ${summary || "ok"}`);
      qc.invalidateQueries({ queryKey: ["heal-launcher-last-runs"] });
      qc.invalidateQueries(); // refresh KPI/lane cards too
    },
    onError: (e: any) => {
      toast.error(`${spec.label}: ${e?.message ?? "Fehler"}`);
    },
    onSettled: () => setOpen(false),
  });

  const Icon = spec.icon;
  const statusOk = last?.status === "ok" || last?.status === "success" || last?.status === "completed";
  const statusErr = last?.status === "error" || last?.status === "failed" || last?.status === "alert";

  const toneBorder =
    spec.tone === "destructive"
      ? "border-destructive/40 hover:border-destructive/70"
      : spec.tone === "warning"
        ? "border-warning/40 hover:border-warning/70"
        : "border-border hover:border-primary/40";

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Card className={`p-3 flex flex-col gap-2 transition-colors ${toneBorder}`}>
        <div className="flex items-start gap-2">
          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${
            spec.tone === "destructive" ? "text-destructive"
              : spec.tone === "warning" ? "text-warning" : "text-primary"
          }`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight">{spec.label}</div>
            <div className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
              {spec.hint}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {last ? (
              <>
                <Badge
                  variant={statusErr ? "destructive" : statusOk ? "outline" : "secondary"}
                  className="h-4 px-1.5 text-[10px]"
                >
                  {statusErr ? "Fehler" : statusOk ? "ok" : (last.status ?? "?")}
                </Badge>
                <span>vor {formatAgo(last.created_at)}</span>
              </>
            ) : (
              <span className="italic">nie ausgeführt</span>
            )}
          </div>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant={spec.tone === "destructive" ? "destructive" : "outline"}
              disabled={mut.isPending}
              className="h-7 px-2.5 text-xs"
            >
              {mut.isPending
                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> läuft…</>
                : <>Run <Activity className="h-3 w-3 ml-1" /></>}
            </Button>
          </AlertDialogTrigger>
        </div>
      </Card>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {spec.label}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-sm">
            <span className="block">{spec.confirm}</span>
            <span className="block text-muted-foreground text-xs">
              Audit-Pfad: <span className="font-mono">auto_heal_log.action_type IN ({spec.audit_action_types.join(", ")})</span>
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mut.isPending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); mut.mutate(); }}
            disabled={mut.isPending}
            className={spec.tone === "destructive" ? "bg-destructive hover:bg-destructive/90" : ""}
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Ausführen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────

function Section({ groupKey }: { groupKey: LauncherSpec["group"] }) {
  const { data: lastRuns } = useLastRuns();
  const meta = GROUPS[groupKey];
  const specs = useMemo(() => SPECS.filter((s) => s.group === groupKey), [groupKey]);
  const Icon = meta.icon;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
          {meta.title}
        </span>
        <span className="text-[10px] text-muted-foreground/60">· {specs.length}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {specs.map((s) => <Tile key={s.id} spec={s} last={lastRuns?.[s.id]} />)}
      </div>
    </div>
  );
}

// ─── Public Component ───────────────────────────────────────────────────────

export function HealFunctionLauncher() {
  return (
    <Card className="p-4 border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Heal-Function Launcher
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            One-Click-Ausführung aller Heal-Aktionen. Confirm-Dialog + Audit in <span className="font-mono">auto_heal_log</span>.
          </p>
        </div>
      </div>
      <div className="space-y-4">
        <Section groupKey="reaper" />
        <Section groupKey="bulk" />
        <Section groupKey="package" />
        <Section groupKey="sellable" />
        <Section groupKey="cleanup" />
      </div>
    </Card>
  );
}

export default HealFunctionLauncher;
