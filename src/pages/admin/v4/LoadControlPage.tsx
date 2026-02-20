import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Pause, Play, RotateCcw, Trash2, Zap, ShieldAlert, DollarSign, Activity, Shield, Settings2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

interface RateLimit {
  id: string;
  provider: string;
  max_concurrent: number;
  cooldown_seconds: number;
  is_paused: boolean;
}

interface Budget {
  id: string;
  month: string;
  budget_eur: number;
  spent_eur: number;
  hard_stop: boolean;
  max_active_packages: number | null;
}

interface TriagePolicyRow {
  id: string;
  version: string;
  mode: string;
  is_active: boolean;
  created_at: string;
  notes: string | null;
}

interface DeadLetterJob {
  id: string;
  job_type: string;
  error_category: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  resolved_at: string | null;
}

export default function LoadControlPage() {
  const qc = useQueryClient();
  const [concurrencyEdits, setConcurrencyEdits] = useState<Record<string, string>>({});

  const { data: rateLimits, isLoading: rlLoading } = useQuery({
    queryKey: ["llm-rate-limits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("llm_rate_limits")
        .select("*")
        .order("provider");
      if (error) throw error;
      return data as RateLimit[];
    },
    refetchInterval: 5000,
  });

  const { data: budget } = useQuery({
    queryKey: ["llm-budget"],
    queryFn: async () => {
      const month = new Date().toISOString().slice(0, 7);
      const { data, error } = await supabase
        .from("llm_budget")
        .select("*")
        .eq("month", month)
        .maybeSingle();
      if (error) throw error;
      return data as Budget | null;
    },
    refetchInterval: 10000,
  });

  const { data: triagePolicy } = useQuery({
    queryKey: ["triage-policy"],
    queryFn: async () => {
      const { data } = await supabase
        .from("triage_policy")
        .select("id, version, mode, is_active, created_at, notes")
        .eq("is_active", true)
        .maybeSingle();
      return data as TriagePolicyRow | null;
    },
  });

  const { data: runningLLM } = useQuery({
    queryKey: ["running-llm-jobs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("job_queue")
        .select("provider")
        .eq("status", "processing")
        .not("provider", "is", null);
      if (!data) return {};
      const counts: Record<string, number> = {};
      data.forEach((r: { provider: string | null }) => {
        if (r.provider) counts[r.provider] = (counts[r.provider] || 0) + 1;
      });
      return counts;
    },
    refetchInterval: 3000,
  });

  const { data: jobStats } = useQuery({
    queryKey: ["job-stats-lc"],
    queryFn: async () => {
      const { data: raw } = await supabase.from("job_queue").select("status").limit(5000);
      if (!raw) return {} as Record<string, number>;
      const counts: Record<string, number> = {};
      raw.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
      return counts;
    },
    refetchInterval: 5000,
  });

  const { data: deadLetters } = useQuery({
    queryKey: ["dead-letters"],
    queryFn: async () => {
      const { data } = await supabase
        .from("dead_letter_jobs")
        .select("id, job_type, error_category, error_code, error_message, created_at, resolved_at")
        .is("resolved_at", null)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as DeadLetterJob[];
    },
    refetchInterval: 10000,
  });

  const { data: buildingMetrics } = useQuery({
    queryKey: ["building-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_building_metrics");
      if (error) throw error;
      return data as { active_by_jobs: number; active_by_leases: number; status_building: number; zombies: number };
    },
    refetchInterval: 5000,
  });
  const activePackages = buildingMetrics?.active_by_leases ?? 0;

  const togglePause = useMutation({
    mutationFn: async ({ provider, pause }: { provider: string; pause: boolean }) => {
      const { error } = await supabase
        .from("llm_rate_limits")
        .update({ is_paused: pause, updated_at: new Date().toISOString() })
        .eq("provider", provider);
      if (error) throw error;
    },
    onSuccess: (_, { provider, pause }) => {
      toast.success(`${provider} ${pause ? "pausiert" : "fortgesetzt"}`);
      qc.invalidateQueries({ queryKey: ["llm-rate-limits"] });
    },
  });

  const updateConcurrency = useMutation({
    mutationFn: async ({ provider, value }: { provider: string; value: number }) => {
      const { error } = await supabase
        .from("llm_rate_limits")
        .update({ max_concurrent: value, updated_at: new Date().toISOString() })
        .eq("provider", provider);
      if (error) throw error;
    },
    onSuccess: (_, { provider }) => {
      toast.success(`Concurrency für ${provider} aktualisiert`);
      qc.invalidateQueries({ queryKey: ["llm-rate-limits"] });
    },
  });

  const toggleHardStop = useMutation({
    mutationFn: async (hardStop: boolean) => {
      if (!budget) return;
      const { error } = await supabase
        .from("llm_budget")
        .update({ hard_stop: hardStop })
        .eq("id", budget.id);
      if (error) throw error;
    },
    onSuccess: (_, hardStop) => {
      toast.success(`Hard Stop ${hardStop ? "aktiviert" : "deaktiviert"}`);
      qc.invalidateQueries({ queryKey: ["llm-budget"] });
    },
  });

  const retryRateLimited = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("job_queue")
        .update({
          status: "pending",
          scheduled_at: null,
          rate_limited_until: null,
          last_error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq("status", "failed")
        .in("last_error_code", ["RATE_LIMIT", "RATE_LIMIT_EXHAUSTED", "TIMEOUT_EXHAUSTED", "TRANSIENT_NETWORK_EXHAUSTED"]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transiente Fehler zurückgesetzt");
      qc.invalidateQueries({ queryKey: ["job-stats-lc"] });
    },
  });

  const cancelFailed = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("job_queue")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("status", "failed");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Failed Jobs abgebrochen");
      qc.invalidateQueries({ queryKey: ["job-stats-lc"] });
    },
  });

  const spentPct = budget ? Math.round((budget.spent_eur / budget.budget_eur) * 100) : 0;
  const totalRunning = Object.values(runningLLM ?? {}).reduce((a, b) => a + b, 0);
  const maxActive = budget?.max_active_packages ?? 4;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Load Controller</h1>
          <p className="text-sm text-muted-foreground">Provider-Steuerung, Budget, Triage-Policy & Dead Letters</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={totalRunning > 0 ? "default" : "secondary"}>
            <Activity className="h-3 w-3 mr-1" />
            {totalRunning} LLM aktiv
          </Badge>
          <Badge variant="outline">
            📦 {activePackages}/{maxActive} Packages
          </Badge>
        </div>
      </div>

      {/* Triage Policy Card */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Triage Policy
          </CardTitle>
        </CardHeader>
        <CardContent>
          {triagePolicy ? (
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="default">{triagePolicy.mode}</Badge>
                  <span className="text-sm font-mono">v{triagePolicy.version}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {triagePolicy.notes ?? "Active triage policy"}
                </p>
              </div>
              <Badge variant="outline" className="text-green-600">
                ✅ Aktiv
              </Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Keine aktive Triage Policy</p>
          )}
        </CardContent>
      </Card>

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {rlLoading ? (
          <Loader2 className="animate-spin" />
        ) : (
          rateLimits?.map((rl) => {
            const running = (runningLLM ?? {})[rl.provider] ?? 0;
            const pct = Math.min(100, (running / rl.max_concurrent) * 100);
            const isHot = pct >= 80;
            return (
              <Card key={rl.id} className={rl.is_paused ? "border-destructive/50" : isHot ? "border-yellow-500/50" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="capitalize">{rl.provider}</span>
                    {rl.is_paused ? (
                      <Badge variant="destructive">Pausiert</Badge>
                    ) : isHot ? (
                      <Badge className="bg-yellow-500 text-white">Heiß</Badge>
                    ) : (
                      <Badge variant="outline">Aktiv</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Running / Max</span>
                    <span className="font-mono font-bold">
                      {running} / {rl.max_concurrent}
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${isHot ? "bg-yellow-500" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      className="h-8 w-20 text-xs"
                      value={concurrencyEdits[rl.provider] ?? String(rl.max_concurrent)}
                      onChange={(e) => setConcurrencyEdits(prev => ({ ...prev, [rl.provider]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => {
                        const val = parseInt(concurrencyEdits[rl.provider] ?? String(rl.max_concurrent));
                        if (val >= 1 && val <= 10) updateConcurrency.mutate({ provider: rl.provider, value: val });
                      }}
                    >
                      <Settings2 className="h-3 w-3 mr-1" /> Set
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant={rl.is_paused ? "default" : "destructive"}
                    className="w-full"
                    onClick={() => togglePause.mutate({ provider: rl.provider, pause: !rl.is_paused })}
                  >
                    {rl.is_paused ? <Play className="h-3 w-3 mr-1" /> : <Pause className="h-3 w-3 mr-1" />}
                    {rl.is_paused ? "Fortsetzen" : "Pausieren"}
                  </Button>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Budget + Queue */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Budget ({budget?.month ?? "—"})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {budget ? (
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span>Verbraucht</span>
                  <span className="font-mono font-bold">€{budget.spent_eur.toFixed(2)} / €{budget.budget_eur.toFixed(2)}</span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${spentPct > 90 ? "bg-destructive" : spentPct > 70 ? "bg-yellow-500" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, spentPct)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{spentPct}%</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Hard Stop</span>
                    <Switch
                      checked={budget.hard_stop}
                      onCheckedChange={(checked) => toggleHardStop.mutate(checked)}
                    />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Burn: ~€{(budget.spent_eur / Math.max(1, new Date().getDate())).toFixed(1)}/Tag · 
                  Forecast: {Math.round((budget.budget_eur - budget.spent_eur) / Math.max(0.1, budget.spent_eur / Math.max(1, new Date().getDate())))} Tage
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Kein Budget konfiguriert</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Queue Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {["pending", "processing", "completed", "failed", "cancelled"].map((s) => (
                <div key={s} className="flex justify-between">
                  <span className="capitalize text-muted-foreground">{s}</span>
                  <span className="font-mono font-bold">{(jobStats ?? {})[s] ?? 0}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => retryRateLimited.mutate()}>
                <RotateCcw className="h-3 w-3 mr-1" />
                Retry Transient
              </Button>
              <Button size="sm" variant="destructive" className="flex-1" onClick={() => cancelFailed.mutate()}>
                <Trash2 className="h-3 w-3 mr-1" />
                Cancel Failed
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dead Letters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Dead Letters ({deadLetters?.length ?? 0} unresolved)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deadLetters && deadLetters.length > 0 ? (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {deadLetters.map((dl) => (
                <div key={dl.id} className="flex items-center justify-between text-xs py-1.5 border-b border-muted last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant="destructive"
                      className="text-[10px] shrink-0"
                    >
                      {dl.error_category}
                    </Badge>
                    <span className="font-mono truncate">{dl.job_type}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0 ml-2">
                    {new Date(dl.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Keine Dead Letters 🎉</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
