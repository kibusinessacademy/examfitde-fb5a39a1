import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlaskConical, Loader2, AlertTriangle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { buildRuntimeDiff, summarizeRuntimeDiff } from "@/lib/runtime/diff/runtimeDiff";

interface SafeAction {
  action_key: string;
  label: string;
  risk_level: string;
  rollback_supported: boolean;
}

interface SimResult {
  action_key: string;
  would_execute: boolean;
  risk_level: string;
  risk_score: number;
  reversible: boolean;
  reversible_window_min: number;
  predicted_before: unknown;
  predicted_after: unknown;
  blast_radius: Record<string, unknown>;
  warnings: string[];
  simulated_at: string;
  error?: string;
}

const RISK_TONE: Record<string, string> = {
  LOW: "bg-muted text-muted-foreground",
  MEDIUM: "bg-warning-bg-subtle text-warning",
  HIGH: "bg-destructive-bg-subtle text-destructive",
  CRITICAL: "bg-destructive text-destructive-foreground",
};

export default function RuntimeDryRunCard() {
  const [actionKey, setActionKey] = useState<string>("");
  const [payloadText, setPayloadText] = useState<string>("{}");
  const [result, setResult] = useState<SimResult | null>(null);

  const { data: actions } = useQuery({
    queryKey: ["runtime-safe-actions-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("runtime_safe_actions")
        .select("action_key,label,risk_level,rollback_supported")
        .eq("is_enabled", true)
        .order("action_key");
      if (error) throw error;
      return (data ?? []) as unknown as SafeAction[];
    },
  });

  const simulate = useMutation({
    mutationFn: async () => {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(payloadText || "{}"); } catch { throw new Error("Invalid JSON payload"); }
      const { data, error } = await supabase.rpc("admin_runtime_action_simulate" as never, {
        _action_key: actionKey, _payload: payload,
      } as never);
      if (error) throw error;
      return data as unknown as SimResult;
    },
    onSuccess: (r) => { setResult(r); toast.success(`Simulated · risk ${r.risk_score}/100`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const diff = result ? buildRuntimeDiff(result.predicted_before, result.predicted_after) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4" /> Dry-Run Simulation
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Predict before/after, blast radius, and risk score with <strong>zero mutation</strong>.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1">
            <Label className="text-xs">Action</Label>
            <Select value={actionKey} onValueChange={setActionKey}>
              <SelectTrigger><SelectValue placeholder="Pick a safe action…" /></SelectTrigger>
              <SelectContent>
                {(actions ?? []).map((a) => (
                  <SelectItem key={a.action_key} value={a.action_key}>
                    <span className="font-mono text-xs">{a.action_key}</span>
                    <Badge variant="outline" className="ml-2 text-[10px]">{a.risk_level}</Badge>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => simulate.mutate()}
              disabled={!actionKey || simulate.isPending}
              className="gap-1.5"
            >
              {simulate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              Simulate
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Payload (JSON)</Label>
          <Textarea
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            rows={4}
            className="font-mono text-xs"
            placeholder='{ "policy_key": "…" }'
          />
        </div>

        {result && !result.error && (
          <div className="space-y-3 rounded border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={RISK_TONE[result.risk_level] ?? "bg-muted"}>
                {result.risk_level} · risk {result.risk_score}
              </Badge>
              {result.reversible ? (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <ShieldCheck className="h-3 w-3" /> reversible {result.reversible_window_min}min
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">one-way</Badge>
              )}
              {result.warnings?.length > 0 && (
                <Badge variant="outline" className="gap-1 text-[10px] border-status-border-warning text-status-fg-warning">
                  <AlertTriangle className="h-3 w-3" /> {result.warnings.join(", ")}
                </Badge>
              )}
            </div>

            {diff && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground">
                  Predicted Diff · {summarizeRuntimeDiff(diff)}
                </div>
                <div className="mt-1 space-y-1">
                  {diff.entries.slice(0, 20).map((e, i) => (
                    <div key={i} className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-xs ${e.critical ? "border-status-border-danger bg-status-bg-subtle-danger" : "border-border bg-background"}`}>
                      <Badge variant="outline" className="text-[10px]">{e.kind}</Badge>
                      <span className="font-mono text-[11px]">{e.path}</span>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                        <span className="line-through opacity-60">{JSON.stringify(e.before)}</span>
                        <span className="mx-1">→</span>
                        <span className="text-foreground">{JSON.stringify(e.after)}</span>
                      </span>
                    </div>
                  ))}
                  {diff.entries.length === 0 && (
                    <p className="text-xs text-muted-foreground">No mutations predicted.</p>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs font-semibold text-muted-foreground">Blast Radius</div>
              <pre className="mt-1 overflow-x-auto rounded border border-border bg-background p-2 font-mono text-[11px]">
                {JSON.stringify(result.blast_radius, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {result?.error && (
          <p className="text-xs text-destructive">{String(result.error)}</p>
        )}
      </CardContent>
    </Card>
  );
}
