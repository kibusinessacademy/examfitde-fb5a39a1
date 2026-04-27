/**
 * ReaperGovernanceCard — Reaper Config + Manual Run + Audit-Log.
 * Sources:
 *  - admin_settings.key='reaper_config'
 *  - RPC fn_reap_stale_jobs_configurable
 *  - admin_reaper_audit
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Play, Settings } from "lucide-react";
import { toast } from "sonner";

interface ReaperConfig {
  stale_recoveries_threshold: number;
  max_cancels_per_run: number;
  orphan_lock_minutes: number;
  cron_interval_minutes: number;
  enabled: boolean;
}

const DEFAULT_REAPER: ReaperConfig = {
  stale_recoveries_threshold: 5,
  max_cancels_per_run: 200,
  orphan_lock_minutes: 15,
  cron_interval_minutes: 10,
  enabled: true,
};

export function ReaperGovernanceCard() {
  const qc = useQueryClient();

  const reaper = useQuery({
    queryKey: ["reaper-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_settings")
        .select("value, updated_at")
        .eq("key", "reaper_config")
        .maybeSingle();
      if (error) throw error;
      return {
        cfg: (data?.value as unknown as ReaperConfig) ?? DEFAULT_REAPER,
        updated_at: data?.updated_at as string | undefined,
      };
    },
  });

  const reaperAudit = useQuery({
    queryKey: ["reaper-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_reaper_audit" as any)
        .select("*")
        .order("run_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 60_000,
  });

  const runReaper = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("fn_reap_stale_jobs_configurable" as any);
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      toast.success(
        `Reaper: ${res?.cancelled ?? 0} cancelled · ${res?.unlocked ?? 0} unlocked · ${res?.terminal ?? 0} terminal`,
      );
      qc.invalidateQueries({ queryKey: ["reaper-audit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Reaper-Run fehlgeschlagen"),
  });

  const saveReaper = useMutation({
    mutationFn: async (cfg: ReaperConfig) => {
      const { error } = await supabase
        .from("admin_settings")
        .update({ value: cfg as any, updated_at: new Date().toISOString() })
        .eq("key", "reaper_config");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reaper-Config gespeichert");
      qc.invalidateQueries({ queryKey: ["reaper-config"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Speichern fehlgeschlagen"),
  });

  const reaperCfg = reaper.data?.cfg ?? DEFAULT_REAPER;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Settings className="h-4 w-4" /> Reaper Configuration
            </h3>
            <p className="text-xs text-muted-foreground">
              Schwellenwerte für fn_reap_stale_jobs_configurable (cron alle{" "}
              {reaperCfg.cron_interval_minutes} min)
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => runReaper.mutate()}
            disabled={runReaper.isPending}
          >
            <Play className="h-3.5 w-3.5 mr-1.5" /> Jetzt ausführen
          </Button>
        </div>
        <ReaperForm cfg={reaperCfg} onSave={(c) => saveReaper.mutate(c)} pending={saveReaper.isPending} />
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Audit-Log (letzte 50 Aktionen)</h3>
        <div className="border rounded-md max-h-[400px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Zeit</TableHead>
                <TableHead className="text-xs">Action</TableHead>
                <TableHead className="text-xs">Job-Type</TableHead>
                <TableHead className="text-xs">Package</TableHead>
                <TableHead className="text-xs">Reason</TableHead>
                <TableHead className="text-xs">Attempts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reaperAudit.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">
                    Keine Aktionen bisher.
                  </TableCell>
                </TableRow>
              ) : (
                (reaperAudit.data ?? []).map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-[10px] text-muted-foreground">
                      {new Date(a.run_at).toLocaleString("de-DE")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={a.action === "hard_cancel" ? "destructive" : "outline"}
                        className="text-[10px]"
                      >
                        {a.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[10px] font-mono">{a.job_type}</TableCell>
                    <TableCell className="text-[10px] font-mono">
                      {a.package_id ? a.package_id.slice(0, 8) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.reason}</TableCell>
                    <TableCell className="text-xs font-mono tabular-nums">
                      {a.transient_attempts ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function ReaperForm({
  cfg, onSave, pending,
}: {
  cfg: ReaperConfig; onSave: (c: ReaperConfig) => void; pending: boolean;
}) {
  const [local, setLocal] = useState<ReaperConfig>(cfg);
  const dirty = JSON.stringify(local) !== JSON.stringify(cfg);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          id="threshold"
          label="Stale-Recoveries Threshold"
          hint="Hard-Cancel ab N transient_attempts"
          value={local.stale_recoveries_threshold}
          onChange={(v) => setLocal({ ...local, stale_recoveries_threshold: v })}
        />
        <Field
          id="max"
          label="Max Cancels / Run"
          hint="Sicherheits-Cap pro Reaper-Lauf"
          value={local.max_cancels_per_run}
          onChange={(v) => setLocal({ ...local, max_cancels_per_run: v })}
        />
        <Field
          id="orphan"
          label="Orphan-Lock Minuten"
          hint="Locked, never started → unlock"
          value={local.orphan_lock_minutes}
          onChange={(v) => setLocal({ ...local, orphan_lock_minutes: v })}
        />
        <Field
          id="cron"
          label="Cron-Intervall (Minuten)"
          hint="Nur Anzeige – Anpassung erfordert DB-Migration"
          value={local.cron_interval_minutes}
          onChange={(v) => setLocal({ ...local, cron_interval_minutes: v })}
          disabled
        />
      </div>
      <div className="flex items-center justify-between border-t pt-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={local.enabled}
            onCheckedChange={(v) => setLocal({ ...local, enabled: v })}
            id="reaper-enabled"
          />
          <Label htmlFor="reaper-enabled" className="text-xs">Reaper aktiv</Label>
        </div>
        <Button size="sm" onClick={() => onSave(local)} disabled={!dirty || pending}>
          Speichern
        </Button>
      </div>
    </div>
  );
}

function Field({
  id, label, hint, value, onChange, disabled,
}: {
  id: string; label: string; hint: string; value: number;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 text-sm font-mono"
      />
      <div className="text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}
