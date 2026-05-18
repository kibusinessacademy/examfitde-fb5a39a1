import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Send, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type IdempotencyState = "eligible" | "already_planned" | "already_dispatched" | string;

type Preview = {
  window_hours: number;
  total: number;
  fetched_at: string;
  items: Array<{
    grant_id: string;
    package_id: string | null;
    package_key: string | null;
    track: string | null;
    learner_ref: string;
    current_stage: string;
    blocked_reason: string | null;
    nudge_type: string;
    dedupe_key: string;
    minutes_since_grant: number | null;
    idempotency_state: IdempotencyState;
    existing_event_id: string | null;
    existing_at: string | null;
  }>;
};

const WINDOWS = [
  { value: 24, label: "24h" },
  { value: 48, label: "48h" },
  { value: 168, label: "7d" },
];

function fmtMins(m: number | null) {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m < 60) return `${Math.round(m)}min`;
  if (m < 1440) return `${(m / 60).toFixed(1)}h`;
  return `${(m / 1440).toFixed(1)}d`;
}

function idemBadge(s: IdempotencyState) {
  if (s === "eligible") {
    return "bg-status-info-bg-subtle text-status-info-fg";
  }
  if (s === "already_planned") {
    return "bg-status-warning-bg-subtle text-status-warning-fg";
  }
  if (s === "already_dispatched") {
    return "bg-status-success-bg-subtle text-status-success-fg";
  }
  return "bg-surface-muted text-text-secondary";
}

export function ActivationNudgeDispatcherCard() {
  const [windowHours, setWindowHours] = useState(48);
  const [reason, setReason] = useState("");
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "activation-nudge-preview", windowHours],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "admin_preview_activation_nudges" as any,
        { _window_hours: windowHours, _limit: 50 },
      );
      if (error) throw error;
      return data as unknown as Preview;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const dispatch = useMutation({
    mutationFn: async (args: { grant_id: string; dry_run: boolean }) => {
      const { data, error } = await supabase.rpc(
        "admin_dispatch_activation_nudge" as any,
        { _grant_id: args.grant_id, _reason: reason.trim(), _dry_run: args.dry_run },
      );
      if (error) throw error;
      return data as { status: string; skip_reason?: string; nudge_type?: string; event_id?: string };
    },
    onSuccess: (res, vars) => {
      const label = vars.dry_run ? "Dry-run" : res.status === "planned" ? "Nudge geplant" : "Skip";
      toast({
        title: `${label}: ${res.status}`,
        description: res.skip_reason
          ? `skip_reason=${res.skip_reason}`
          : `${res.nudge_type ?? ""}${res.event_id ? ` · ${res.event_id.slice(0, 8)}` : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["admin", "activation-nudge-preview"] });
    },
    onError: (e: any) => {
      toast({ title: "Fehler", description: String(e?.message ?? e), variant: "destructive" });
    },
  });

  const reasonValid = reason.trim().length >= 4;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Activation Nudge Dispatcher (Cut 1d)</CardTitle>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Idempotente Vorstufe: plant Nudges aus Cut-1c-Stale-Signalen. Kein Direktversand.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
            <TabsList className="h-7">
              {WINDOWS.map((w) => (
                <TabsTrigger key={w.value} value={String(w.value)} className="text-xs h-6 px-2">
                  {w.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-7">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Pflicht-Begründung (min 4 Zeichen) — wird auditiert"
            className="h-8 text-xs"
          />
          <div className="text-[11px] text-text-tertiary">
            Dry-run = nur Klassifikation. Plan = Ledger-Insert (kein Versand).
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
          </div>
        ) : isError ? (
          <div className="text-sm text-status-error-fg">
            Fehler: {(error as Error)?.message ?? "unknown"}
          </div>
        ) : !data || data.total === 0 ? (
          <div className="rounded-md border border-border bg-surface-muted/40 p-4 text-sm text-text-tertiary">
            Keine stale Aktivierungen in diesem Zeitfenster.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
              <AlertTriangle className="h-3.5 w-3.5" /> Stale Grants mit empfohlenem Nudge ({data.total})
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-md border border-border divide-y divide-border">
              {data.items.map((it) => {
                const eligible = it.idempotency_state === "eligible";
                const pending = dispatch.isPending && dispatch.variables?.grant_id === it.grant_id;
                return (
                  <div
                    key={it.grant_id}
                    className="grid grid-cols-12 gap-2 p-2 text-[11px] items-center"
                  >
                    <div className="col-span-2 font-mono truncate text-text-tertiary">
                      {it.learner_ref}
                    </div>
                    <div className="col-span-2 truncate">
                      {it.package_key ?? it.package_id?.slice(0, 8) ?? "—"}
                    </div>
                    <div className="col-span-2">
                      <Badge variant="outline" className="bg-surface-muted text-text-secondary">
                        {it.current_stage}
                      </Badge>
                    </div>
                    <div className="col-span-2">
                      <Badge variant="secondary" className="font-mono">
                        {it.nudge_type}
                      </Badge>
                    </div>
                    <div className="col-span-1 text-text-tertiary tabular-nums">
                      {fmtMins(it.minutes_since_grant)}
                    </div>
                    <div className="col-span-1">
                      <Badge variant="outline" className={idemBadge(it.idempotency_state)}>
                        {it.idempotency_state.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="col-span-2 flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        disabled={!reasonValid || pending}
                        onClick={() => dispatch.mutate({ grant_id: it.grant_id, dry_run: true })}
                      >
                        Dry-run
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px]"
                        disabled={!reasonValid || !eligible || pending}
                        onClick={() => dispatch.mutate({ grant_id: it.grant_id, dry_run: false })}
                      >
                        {pending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Send className="mr-1 h-3 w-3" /> Plan
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
              <ShieldCheck className="h-3 w-3" />
              Idempotenz: 6h-Fenster pro Grant + Stage + Nudge. Duplikate → `skip_reason=idempotent_duplicate`.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
