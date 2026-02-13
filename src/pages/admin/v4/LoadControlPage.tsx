import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Pause, Play, RotateCcw, Trash2, Zap, ShieldAlert, DollarSign, Activity } from "lucide-react";
import { toast } from "sonner";

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
}

interface JobStats {
  status: string;
  count: number;
}

interface FailedJob {
  id: string;
  job_type: string;
  last_error_code: string | null;
  last_error: string | null;
  attempts: number;
  created_at: string;
}

export default function LoadControlPage() {
  const qc = useQueryClient();

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

  const { data: jobStats } = useQuery({
    queryKey: ["job-stats"],
    queryFn: async () => {
      const { data: raw } = await supabase
        .from("job_queue")
        .select("status")
        .limit(5000);
      if (!raw) return [] as JobStats[];
      const counts: Record<string, number> = {};
      raw.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
      return Object.entries(counts).map(([status, count]) => ({ status, count })) as JobStats[];
    },
    refetchInterval: 5000,
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

  const { data: failedJobs } = useQuery({
    queryKey: ["failed-jobs-recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("job_queue")
        .select("id, job_type, last_error_code, last_error, attempts, created_at")
        .eq("status", "failed")
        .order("completed_at", { ascending: false })
        .limit(20);
      return (data ?? []) as FailedJob[];
    },
    refetchInterval: 10000,
  });

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
        .in("last_error_code", ["RATE_LIMIT", "RATE_LIMIT_EXHAUSTED"]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rate-limited Jobs zurückgesetzt");
      qc.invalidateQueries({ queryKey: ["failed-jobs-recent"] });
      qc.invalidateQueries({ queryKey: ["job-stats"] });
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
      qc.invalidateQueries({ queryKey: ["failed-jobs-recent"] });
      qc.invalidateQueries({ queryKey: ["job-stats"] });
    },
  });

  const statMap = (jobStats ?? []).reduce((acc, s) => {
    acc[s.status] = s.count;
    return acc;
  }, {} as Record<string, number>);

  const spentPct = budget ? Math.round((budget.spent_eur / budget.budget_eur) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">LLM Load Controller</h1>
        <Badge variant={Object.values(runningLLM ?? {}).some((v) => v > 0) ? "default" : "secondary"}>
          <Activity className="h-3 w-3 mr-1" />
          {Object.values(runningLLM ?? {}).reduce((a, b) => a + b, 0)} LLM aktiv
        </Badge>
      </div>

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {rlLoading ? (
          <Loader2 className="animate-spin" />
        ) : (
          rateLimits?.map((rl) => (
            <Card key={rl.id} className={rl.is_paused ? "border-destructive/50" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="capitalize">{rl.provider}</span>
                  {rl.is_paused ? (
                    <Badge variant="destructive">Pausiert</Badge>
                  ) : (
                    <Badge variant="outline">Aktiv</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Running / Max</span>
                  <span className="font-mono font-bold">
                    {(runningLLM ?? {})[rl.provider] ?? 0} / {rl.max_concurrent}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cooldown</span>
                  <span className="font-mono">{rl.cooldown_seconds}s</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(100, (((runningLLM ?? {})[rl.provider] ?? 0) / rl.max_concurrent) * 100)}%`,
                    }}
                  />
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
          ))
        )}
      </div>

      {/* Budget + Queue Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              LLM Budget ({budget?.month ?? "—"})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {budget ? (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Verbraucht</span>
                  <span className="font-mono font-bold">€{budget.spent_eur.toFixed(2)} / €{budget.budget_eur.toFixed(2)}</span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${spentPct > 80 ? "bg-destructive" : spentPct > 50 ? "bg-yellow-500" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, spentPct)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{spentPct}%</span>
                  <span>Hard Stop: {budget.hard_stop ? "✅ aktiv" : "❌ inaktiv"}</span>
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
                  <span className="font-mono font-bold">{statMap[s] ?? 0}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Failed Jobs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              Failed Jobs ({failedJobs?.length ?? 0})
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => retryRateLimited.mutate()}>
                <RotateCcw className="h-3 w-3 mr-1" />
                Retry Rate-Limited
              </Button>
              <Button size="sm" variant="destructive" onClick={() => cancelFailed.mutate()}>
                <Trash2 className="h-3 w-3 mr-1" />
                Alle abbrechen
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {failedJobs && failedJobs.length > 0 ? (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {failedJobs.map((j) => (
                <div key={j.id} className="flex items-center justify-between text-xs py-1 border-b border-muted last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {j.last_error_code || "ERR"}
                    </Badge>
                    <span className="font-mono truncate">{j.job_type}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0 ml-2">×{j.attempts}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Keine fehlgeschlagenen Jobs 🎉</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
