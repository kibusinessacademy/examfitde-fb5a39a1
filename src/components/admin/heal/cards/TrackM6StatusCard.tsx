import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, MailWarning, ShieldCheck, Sliders, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

type M6Audit = {
  window_hours: number;
  provider_events: Record<string, number>;
  suppressed_via_webhook: number;
  tuning_rows: number;
  tuning_enabled_rows: number;
};

type Tuning = {
  id: string;
  persona: string;
  source_curriculum_id: string | null;
  min_confidence: number;
  min_support: number;
  min_lift: number;
  max_promote_per_run: number;
  enabled: boolean;
  notes: string | null;
};

export function TrackM6StatusCard() {
  const qc = useQueryClient();
  const [newPersona, setNewPersona] = useState("");

  const { data: audit, isLoading } = useQuery({
    queryKey: ["track-m6-audit"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_track_m6_audit", { p_window_hours: 168 });
      if (error) throw error;
      return data as unknown as M6Audit;
    },
    refetchInterval: 60_000,
  });

  const { data: tunings, isLoading: tuningLoading } = useQuery({
    queryKey: ["m6-upsell-tuning"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curriculum_upsell_promote_tuning")
        .select("*")
        .order("persona");
      if (error) throw error;
      return (data ?? []) as Tuning[];
    },
  });

  const smoke = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_smoke_track_m6");
      if (error) throw error;
      return data as any;
    },
    onSuccess: (d) => {
      toast.success(
        `M6 Smoke ${d?.ok ? "OK" : "FAIL"} — Ingest:${d?.ingest_rpc_exists ? "✓" : "✗"} · Events:${d?.events_table_exists ? "✓" : "✗"} · Default:${d?.default_tuning_enabled ? "✓" : "✗"}`
      );
    },
    onError: (e: any) => toast.error(`Smoke failed: ${e.message}`),
  });

  const upsert = useMutation({
    mutationFn: async (row: Partial<Tuning> & { persona: string }) => {
      const { error } = await supabase
        .from("curriculum_upsell_promote_tuning")
        .upsert(row as any, { onConflict: "persona,source_curriculum_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["m6-upsell-tuning"] });
      qc.invalidateQueries({ queryKey: ["track-m6-audit"] });
      toast.success("Tuning gespeichert");
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("curriculum_upsell_promote_tuning").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["m6-upsell-tuning"] });
      toast.success("Tuning gelöscht");
    },
    onError: (e: any) => toast.error(`Delete failed: ${e.message}`),
  });

  const eventEntries = Object.entries(audit?.provider_events ?? {});

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Track M6 — Tracking, Suppression & Tuning
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <MailWarning className="h-3.5 w-3.5" /> Resend Provider-Events (7d)
                </span>
                <Badge variant="outline">{audit?.suppressed_via_webhook ?? 0} suppressed</Badge>
              </div>
              {eventEntries.length === 0 ? (
                <div className="text-xs text-muted-foreground">Keine Events. Webhook in Resend einrichten: <code className="text-xs">/functions/v1/resend-webhook</code></div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {eventEntries.map(([k, v]) => (
                    <Badge key={k} variant="secondary" className="text-xs">{k}: {v}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <Sliders className="h-3.5 w-3.5" /> Upsell-Tuning
                </span>
                <Badge variant="outline">{audit?.tuning_enabled_rows ?? 0} / {audit?.tuning_rows ?? 0} aktiv</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Persona-spezifische Schwellwerte für <code>fn_auto_promote_upsell_suggestions_v2</code>.
              </div>
            </div>
          </div>
        )}

        <div className="border-t pt-3">
          <div className="text-sm font-medium mb-2">Tuning-Regeln</div>
          {tuningLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <div className="space-y-2">
              {(tunings ?? []).map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-md border p-2 text-xs">
                  <Badge variant={t.persona === "__default__" ? "default" : "secondary"} className="font-mono">{t.persona}</Badge>
                  <span className="text-muted-foreground">conf ≥</span>
                  <Input
                    type="number" step="0.01" min="0" max="1"
                    defaultValue={t.min_confidence}
                    className="h-7 w-20 text-xs"
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v !== Number(t.min_confidence)) upsert.mutate({ ...t, min_confidence: v });
                    }}
                  />
                  <span className="text-muted-foreground">sup ≥</span>
                  <Input
                    type="number" min="1"
                    defaultValue={t.min_support}
                    className="h-7 w-16 text-xs"
                    onBlur={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v) && v !== t.min_support) upsert.mutate({ ...t, min_support: v });
                    }}
                  />
                  <span className="text-muted-foreground">lift ≥</span>
                  <Input
                    type="number" step="0.1" min="0"
                    defaultValue={t.min_lift}
                    className="h-7 w-16 text-xs"
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v !== Number(t.min_lift)) upsert.mutate({ ...t, min_lift: v });
                    }}
                  />
                  <span className="text-muted-foreground">cap</span>
                  <Input
                    type="number" min="1"
                    defaultValue={t.max_promote_per_run}
                    className="h-7 w-16 text-xs"
                    onBlur={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v) && v !== t.max_promote_per_run) upsert.mutate({ ...t, max_promote_per_run: v });
                    }}
                  />
                  <div className="flex items-center gap-1">
                    <Switch
                      checked={t.enabled}
                      onCheckedChange={(checked) => upsert.mutate({ ...t, enabled: checked })}
                    />
                    <Label className="text-xs">on</Label>
                  </div>
                  {t.persona !== "__default__" && (
                    <Button size="sm" variant="ghost" className="h-7 ml-auto" onClick={() => remove.mutate(t.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1">
                <Input
                  placeholder="neue Persona (z.B. azubi_fisi)"
                  value={newPersona}
                  onChange={(e) => setNewPersona(e.target.value)}
                  className="h-8 text-xs flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!newPersona.trim() || upsert.isPending}
                  onClick={() => {
                    upsert.mutate({
                      persona: newPersona.trim(),
                      source_curriculum_id: null,
                      min_confidence: 0.15,
                      min_support: 5,
                      min_lift: 1.2,
                      max_promote_per_run: 25,
                      enabled: true,
                    });
                    setNewPersona("");
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Button size="sm" variant="outline" onClick={() => smoke.mutate()} disabled={smoke.isPending}>
            {smoke.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Smoke
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
