/**
 * BypassAuditPanel
 * ────────────────
 * Verständliche Audit-Trail-Ansicht für manuelle Bypass-Aktionen
 * (admin_force_steps_done, force_run_job, retry_package_step, unblock_package …).
 *
 * Pro Eintrag: Who/When/Reason · Step-Statuswechsel · Trigger-Zähler · betroffene
 * Pakete · Bypass-Reason. Filter nach Action und Paket.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  ExternalLink,
  Filter,
  RefreshCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";

const BYPASS_ACTIONS = [
  "force_steps_done",
  "force_run_job",
  "retry_package_step",
  "reset_to_step",
  "unblock_package",
  "auto_heal_repair_exhausted",
  "auto_heal_repair_exhausted_meta_aware",
] as const;

interface AdminAction {
  id: string;
  user_id: string | null;
  action: string;
  scope: string | null;
  payload: Record<string, unknown> | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  affected_ids: string[] | null;
  created_at: string;
}

export function BypassAuditPanel() {
  const [filterPkg, setFilterPkg] = useState("");
  const [filterAction, setFilterAction] = useState<string>("");

  const q = useQuery({
    queryKey: ["bypass-audit", filterAction],
    queryFn: async (): Promise<AdminAction[]> => {
      const actionList = filterAction ? [filterAction] : (BYPASS_ACTIONS as readonly string[]);
      const { data, error } = await supabase
        .from("admin_actions")
        .select("id,user_id,action,scope,payload,before_state,after_state,affected_ids,created_at")
        .in("action", actionList as string[])
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data ?? []) as AdminAction[];
    },
    refetchInterval: 90_000,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const rows = q.data ?? [];
    if (!filterPkg.trim()) return rows;
    const f = filterPkg.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (r.affected_ids ?? []).some((id) => id.toLowerCase().includes(f)) ||
        JSON.stringify(r.payload ?? {})
          .toLowerCase()
          .includes(f),
    );
  }, [q.data, filterPkg]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Shield className="h-4 w-4" />
          Bypass-Audit
          <Badge variant="outline" className="text-[10px]">
            {filtered.length} / {q.data?.length ?? 0}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-[11px]"
            onClick={() => void q.refetch()}
          >
            <RefreshCcw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </CardTitle>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <Filter className="h-3 w-3 text-muted-foreground" />
          <Input
            value={filterPkg}
            onChange={(e) => setFilterPkg(e.target.value)}
            placeholder="Paket-ID / payload-suchstring"
            className="h-7 max-w-xs text-xs"
          />
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="">alle Bypass-Actions</option>
            {BYPASS_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {q.isLoading && (
          <div className="p-4 text-xs text-muted-foreground">Lade Audit-Trail…</div>
        )}
        {q.isError && (
          <div className="p-4 text-xs text-destructive">
            Audit-Trail nicht ladbar: {(q.error as Error).message}
          </div>
        )}
        {!q.isLoading && filtered.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground">Keine Einträge im Filter.</div>
        )}
        <Accordion type="multiple" className="divide-y">
          {filtered.map((row) => (
            <AdminActionRow key={row.id} row={row} />
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function AdminActionRow({ row }: { row: AdminAction }) {
  const summary = summarizeAdminAction(row);
  const Icon =
    summary.severity === "high"
      ? ShieldAlert
      : summary.severity === "medium"
      ? Shield
      : ShieldCheck;
  return (
    <AccordionItem value={row.id} className="border-0 px-3">
      <AccordionTrigger className="py-2 hover:no-underline">
        <div className="flex flex-1 items-center gap-2 text-left">
          <Icon
            className={`h-4 w-4 shrink-0 ${
              summary.severity === "high"
                ? "text-destructive"
                : summary.severity === "medium"
                ? "text-amber-600 dark:text-amber-400"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{summary.headline}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="font-mono">{row.action}</span>
              <span>·</span>
              <span>{new Date(row.created_at).toLocaleString()}</span>
              {summary.triggerCount > 0 && (
                <>
                  <span>·</span>
                  <Badge variant="outline" className="h-3.5 px-1 text-[9px]">
                    {summary.triggerCount} trigger bypassed
                  </Badge>
                </>
              )}
              {summary.rowsUpdated > 0 && (
                <>
                  <span>·</span>
                  <Badge variant="outline" className="h-3.5 px-1 text-[9px]">
                    {summary.rowsUpdated} rows
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pb-3 text-xs">
        {/* Reason */}
        {summary.reason && (
          <div className="rounded-md border border-border bg-muted/20 p-2">
            <div className="mb-0.5 font-medium text-muted-foreground">Bypass-Reason</div>
            <code className="block whitespace-pre-wrap break-all font-mono text-[11px]">
              {summary.reason}
            </code>
          </div>
        )}

        {/* Step-Status-Wechsel */}
        {summary.stepKeys.length > 0 && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground">Step-Statuswechsel</div>
            <ul className="space-y-0.5">
              {summary.stepKeys.map((sk) => (
                <li key={sk} className="flex items-center gap-1.5 font-mono text-[11px]">
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">
                    {sk}
                  </Badge>
                  <span className="text-muted-foreground">{summary.stepStatusFromTo}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Bypassed Triggers */}
        {summary.triggerGroups && Object.keys(summary.triggerGroups).length > 0 && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground">
              Bypassed Triggers ({summary.triggerCount})
            </div>
            <div className="space-y-1">
              {Object.entries(summary.triggerGroups).map(([table, triggers]) => (
                <div key={table} className="rounded-md border border-border bg-muted/10 p-1.5">
                  <div className="text-[10px] font-medium text-muted-foreground">
                    {table} ({triggers.length})
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {triggers.map((t) => (
                      <Badge key={t} variant="outline" className="h-4 px-1 font-mono text-[9px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Affected Packages */}
        {(row.affected_ids ?? []).length > 0 && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground">
              Betroffene IDs ({(row.affected_ids ?? []).length})
            </div>
            <div className="flex flex-wrap gap-1">
              {(row.affected_ids ?? []).slice(0, 12).map((id) => (
                <Link
                  key={id}
                  to={`/admin/v2/packages/${id}`}
                  className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-primary hover:underline"
                >
                  {id.slice(0, 8)}…
                  <ExternalLink className="h-2.5 w-2.5" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* User */}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <User className="h-3 w-3" />
          {row.user_id ?? "system"}
          {row.scope && (
            <>
              <ChevronRight className="h-3 w-3" />
              <span>scope: {row.scope}</span>
            </>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

interface ActionSummary {
  headline: string;
  reason: string | null;
  stepKeys: string[];
  stepStatusFromTo: string;
  triggerCount: number;
  triggerGroups: Record<string, string[]> | null;
  rowsUpdated: number;
  severity: "low" | "medium" | "high";
}

function summarizeAdminAction(row: AdminAction): ActionSummary {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const reason = (p.reason as string) ?? null;
  const stepKeys = Array.isArray(p.step_keys) ? (p.step_keys as string[]) : [];
  const triggerGroups =
    p.bypassed_trigger_groups && typeof p.bypassed_trigger_groups === "object"
      ? (p.bypassed_trigger_groups as Record<string, string[]>)
      : null;
  const triggerCount = triggerGroups
    ? Object.values(triggerGroups).reduce((acc, arr) => acc + arr.length, 0)
    : 0;
  const rowsUpdated = typeof p.rows_updated === "number" ? p.rows_updated : 0;
  const emergency = p.emergency_bypass === true;

  let severity: "low" | "medium" | "high" = "low";
  if (emergency || triggerCount > 20) severity = "high";
  else if (triggerCount > 0 || row.action === "force_steps_done") severity = "medium";

  let headline = row.action;
  if (row.action === "force_steps_done") {
    headline = `Force-Done · ${stepKeys.join(", ") || "?"}${emergency ? " · EMERGENCY-BYPASS" : ""}`;
  } else if (row.action === "force_run_job") {
    headline = `Force-Run Job · ${(p.job_id as string)?.slice(0, 8) ?? "?"}…`;
  } else if (row.action === "unblock_package") {
    headline = `Unblock Paket · ${(row.affected_ids?.[0] ?? "?").slice(0, 8)}…`;
  } else if (row.action === "retry_package_step") {
    headline = `Retry Step · ${stepKeys.join(", ") || "?"}`;
  } else if (row.action === "reset_to_step") {
    headline = `Reset auf Step · ${(p.step_key as string) ?? "?"}`;
  }

  return {
    headline,
    reason,
    stepKeys,
    stepStatusFromTo: emergency ? "(triggers bypassed) → done" : "→ done",
    triggerCount,
    triggerGroups,
    rowsUpdated,
    severity,
  };
}
