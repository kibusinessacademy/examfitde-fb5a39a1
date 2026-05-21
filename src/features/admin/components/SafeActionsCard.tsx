import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert, Shield, Activity, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface SafeAction {
  action_key: string;
  label: string;
  description: string | null;
  severity: "low" | "medium" | "high" | "critical";
  target_layer: string;
  requires_reason: boolean;
  requires_evidence: boolean;
  requires_snapshot: boolean;
  is_destructive: boolean;
  dispatch_handler: string;
}

interface ActionResult {
  id: string;
  action_key: string;
  actor_uid: string | null;
  reason: string | null;
  severity: string | null;
  status: string;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

const severityTone: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-warning-bg-subtle text-warning",
  high: "bg-destructive-bg-subtle text-destructive",
  critical: "bg-destructive text-destructive-foreground",
};

const statusTone: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-info-bg-subtle text-info",
  completed: "bg-success-bg-subtle text-success",
  failed: "bg-destructive-bg-subtle text-destructive",
  rolled_back: "bg-warning-bg-subtle text-warning",
  cancelled: "bg-muted text-muted-foreground",
};

export default function SafeActionsCard() {
  const queryClient = useQueryClient();
  const [openAction, setOpenAction] = useState<SafeAction | null>(null);
  const [reason, setReason] = useState("");

  const actionsQ = useQuery({
    queryKey: ["runtime-safe-actions"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_runtime_safe_actions");
      if (error) throw error;
      return (data ?? []) as SafeAction[];
    },
    staleTime: 60_000,
  });

  const resultsQ = useQuery({
    queryKey: ["runtime-action-results"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_runtime_action_results", { _limit: 25 });
      if (error) throw error;
      return (data ?? []) as ActionResult[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const dispatch = useMutation({
    mutationFn: async (vars: { action_key: string; reason: string }) => {
      const { data, error } = await supabase.rpc("admin_dispatch_runtime_safe_action", {
        _action_key: vars.action_key,
        _reason: vars.reason,
        _payload: {},
        _severity: null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (resultId) => {
      toast.success("Safe Action dispatched", { description: `result_id: ${String(resultId).slice(0, 8)}…` });
      setOpenAction(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["runtime-action-results"] });
    },
    onError: (err: any) => {
      toast.error("Dispatch failed", { description: err?.message ?? String(err) });
    },
  });

  const grouped = (actionsQ.data ?? []).reduce<Record<string, SafeAction[]>>((acc, a) => {
    (acc[a.target_layer] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Safe Actions</CardTitle>
            <Badge variant="outline" className="text-[10px]">v1</Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            Governance-konforme Runtime-Eingriffe · Reason + Audit Pflicht
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          {actionsQ.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lade Registry…
            </div>
          )}
          {actionsQ.error && (
            <p className="text-sm text-destructive">Fehler beim Laden der Safe-Actions Registry.</p>
          )}
          {!actionsQ.isLoading && Object.entries(grouped).map(([layer, actions]) => (
            <div key={layer} className="space-y-2">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {layer}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {actions.map((a) => (
                  <div
                    key={a.action_key}
                    className="rounded-lg border border-border bg-surface-subtle p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{a.label}</div>
                        <div className="text-xs text-muted-foreground line-clamp-2">
                          {a.description ?? a.dispatch_handler}
                        </div>
                      </div>
                      <Badge className={`text-[10px] ${severityTone[a.severity] ?? ""}`}>
                        {a.severity}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {a.is_destructive && (
                          <Badge variant="outline" className="gap-1 text-[10px] border-destructive/40 text-destructive">
                            <ShieldAlert className="h-2.5 w-2.5" /> destructive
                          </Badge>
                        )}
                        {a.requires_snapshot && (
                          <Badge variant="outline" className="text-[10px]">snapshot</Badge>
                        )}
                        {a.requires_evidence && (
                          <Badge variant="outline" className="text-[10px]">evidence</Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={a.is_destructive ? "outline" : "secondary"}
                        className={a.is_destructive ? "border-destructive/40 text-destructive" : ""}
                        onClick={() => {
                          setOpenAction(a);
                          setReason("");
                        }}
                      >
                        Dispatch
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <History className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Recent Action Results</CardTitle>
        </CardHeader>
        <CardContent>
          {resultsQ.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lade…
            </div>
          )}
          {!resultsQ.isLoading && (resultsQ.data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">Noch keine Safe-Actions ausgelöst.</p>
          )}
          {!resultsQ.isLoading && (resultsQ.data?.length ?? 0) > 0 && (
            <div className="space-y-1">
              {resultsQ.data!.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge className={`text-[10px] ${statusTone[r.status] ?? ""}`}>{r.status}</Badge>
                    <span className="font-mono truncate">{r.action_key}</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    {r.severity && <span>{r.severity}</span>}
                    <span>{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!openAction} onOpenChange={(o) => !o && setOpenAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {openAction?.is_destructive && <ShieldAlert className="h-4 w-4 text-destructive" />}
              {openAction?.label}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {openAction?.description}
              <br />
              <span className="text-xs text-muted-foreground">
                Handler: <code>{openAction?.dispatch_handler}</code> · Severity {openAction?.severity}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Reason {openAction?.requires_reason && <span className="text-destructive">*</span>} (min. 8 Zeichen)
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Begründung für Audit-Log und Evidence-Chain…"
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dispatch.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                dispatch.isPending ||
                (openAction?.requires_reason ? reason.trim().length < 8 : false)
              }
              onClick={(e) => {
                e.preventDefault();
                if (!openAction) return;
                dispatch.mutate({ action_key: openAction.action_key, reason: reason.trim() });
              }}
            >
              {dispatch.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : null}
              Dispatch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
