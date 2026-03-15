import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard } from "@/components/admin/cards/KpiCard";
import { Loader2, RefreshCw, Activity, Database, Truck, Shield, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RecoveryHealth {
  checked_at: string;
  validating_batches_24h: number;
  completed_batches_24h: number;
  failed_batches_24h: number;
  validating_batches_90m: number;
  completed_batches_90m: number;
  polled_batches_6h: number;
  results_imported_6h: number;
  domain_import_completed_6h: number;
  latest_poll_at: string | null;
  import_pending_requests_24h: number;
  domain_imported_requests_90m: number;
  content_versions_90m: number;
  exam_questions_90m: number;
  lesson_jobs_completed_90m: number;
  stale_processing_jobs: number;
  provider_model_mismatches_6h: number;
  overall_health: string;
  polling_health: string;
  import_health: string;
  output_health: string;
  routing_health: string;
  queue_health: string;
}

const healthColor = (h: string) => {
  if (h === "GREEN") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
  if (h === "YELLOW") return "border-amber-500/30 bg-amber-500/10 text-amber-400";
  return "border-rose-500/30 bg-rose-500/10 text-rose-400";
};

const healthDot = (h: string) => {
  if (h === "GREEN") return "bg-emerald-400";
  if (h === "YELLOW") return "bg-amber-400";
  return "bg-rose-400 animate-pulse";
};

function HealthPill({ label, status }: { label: string; status: string }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium", healthColor(status))}>
      <span className={cn("h-2.5 w-2.5 rounded-full", healthDot(status))} />
      {label}
      <span className="ml-auto font-mono text-xs opacity-70">{status}</span>
    </div>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "nie";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins}m`;
  return `vor ${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function BatchRecoveryDashboard() {
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<RecoveryHealth>({
    queryKey: ["batch-recovery-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_ops_batch_recovery_health" as any)
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as RecoveryHealth;
    },
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) return <div className="text-muted-foreground text-sm">Keine Daten verfügbar</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Batch Recovery Monitor</h2>
          <p className="text-xs text-muted-foreground">
            Letzte Prüfung: {timeAgo(data.checked_at)} · Auto-Refresh: 60s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Aktualisieren
        </Button>
      </div>

      {/* Overall Ampel */}
      <div className={cn(
        "rounded-xl border-2 p-4 text-center",
        healthColor(data.overall_health),
      )}>
        <div className="flex items-center justify-center gap-3">
          <span className={cn("h-4 w-4 rounded-full", healthDot(data.overall_health))} />
          <span className="text-xl font-bold">
            {data.overall_health === "GREEN" ? "Pipeline gesund" :
             data.overall_health === "YELLOW" ? "Eingeschränkt" : "Pipeline blockiert"}
          </span>
        </div>
      </div>

      {/* Sub-Ampeln */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <HealthPill label="Polling" status={data.polling_health} />
        <HealthPill label="Import" status={data.import_health} />
        <HealthPill label="Output" status={data.output_health} />
        <HealthPill label="Routing" status={data.routing_health} />
        <HealthPill label="Queue" status={data.queue_health} />
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard
          label="Validating (24h)"
          value={data.validating_batches_24h}
          hint={`90m: ${data.validating_batches_90m}`}
          icon={<Clock className="h-4 w-4 text-amber-400" />}
        />
        <KpiCard
          label="Completed (24h)"
          value={data.completed_batches_24h}
          hint={`90m: ${data.completed_batches_90m}`}
          icon={<Activity className="h-4 w-4 text-emerald-400" />}
        />
        <KpiCard
          label="Failed (24h)"
          value={data.failed_batches_24h}
          icon={<AlertTriangle className="h-4 w-4 text-rose-400" />}
        />
        <KpiCard
          label="Gepollt (6h)"
          value={data.polled_batches_6h}
          hint={`Letzter Poll: ${timeAgo(data.latest_poll_at)}`}
          icon={<RefreshCw className="h-4 w-4 text-blue-400" />}
        />
        <KpiCard
          label="Results Imported (6h)"
          value={data.results_imported_6h}
          icon={<Database className="h-4 w-4 text-purple-400" />}
        />
        <KpiCard
          label="Domain Import (6h)"
          value={data.domain_import_completed_6h}
          icon={<Truck className="h-4 w-4 text-teal-400" />}
        />
        <KpiCard
          label="Import Pending"
          value={data.import_pending_requests_24h}
          hint="Completed aber noch nicht domain-importiert"
          icon={<Clock className="h-4 w-4 text-amber-400" />}
        />
        <KpiCard
          label="Mismatches (6h)"
          value={data.provider_model_mismatches_6h}
          hint="Provider/Model-Inkompatibilitäten"
          icon={<Shield className="h-4 w-4 text-rose-400" />}
        />
      </div>

      {/* Fachliche Writes */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Fachliche Writes (letzte 90 Min)</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{data.content_versions_90m}</div>
            <div className="text-xs text-muted-foreground">Content Versions</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{data.exam_questions_90m}</div>
            <div className="text-xs text-muted-foreground">Exam Questions</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{data.lesson_jobs_completed_90m}</div>
            <div className="text-xs text-muted-foreground">Lesson Jobs</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{data.stale_processing_jobs}</div>
            <div className="text-xs text-muted-foreground">Stale Jobs</div>
          </div>
        </div>
      </div>
    </div>
  );
}
