import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface StuckJobType {
  job_type: string;
  pending: number;
  oldest_hours: number;
}

/**
 * StuckJobTypeAlert v2 – DAG-aware
 *
 * Only alerts for job types that have pending jobs AND the runner
 * has NOT completed any job of that type in the last 24h.
 * Additionally checks if any of those pending jobs have actually been
 * ATTEMPTED (started_at not null) – if none were even attempted,
 * it's likely a DAG-prerequisite wait, not a runner blockade.
 */
export default function StuckJobTypeAlert() {
  const { data: stuckTypes } = useQuery({
    queryKey: ["stuck-job-types-alert-v2"],
    queryFn: async () => {
      // Find pending jobs that have been ATTEMPTED (started_at is not null)
      // or are very old (> 4h) – these are truly stuck, not just DAG-waiting
      const { data: pending } = await supabase
        .from("job_queue")
        .select("job_type, created_at, started_at, run_after")
        .eq("status", "pending");

      if (!pending || pending.length === 0) return [];

      const { data: completed } = await supabase
        .from("job_queue")
        .select("job_type")
        .eq("status", "completed")
        .gte("completed_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const completedTypes = new Set((completed ?? []).map(r => r.job_type));

      // Group pending by type, but only count jobs that are CLAIMABLE
      // (run_after <= now) and have been waiting > 2h
      const now = Date.now();
      const pendingByType: Record<string, { count: number; oldest: string; attempted: number }> = {};

      for (const row of pending) {
        // Skip jobs not yet ready (run_after in the future)
        if (row.run_after && new Date(row.run_after).getTime() > now) continue;

        // Skip jobs younger than 2h – DAG prereqs need time
        const ageMs = now - new Date(row.created_at).getTime();
        if (ageMs < 2 * 60 * 60 * 1000) continue;

        if (!pendingByType[row.job_type]) {
          pendingByType[row.job_type] = { count: 0, oldest: row.created_at, attempted: 0 };
        }
        pendingByType[row.job_type].count++;
        if (row.started_at) pendingByType[row.job_type].attempted++;
        if (row.created_at < pendingByType[row.job_type].oldest) {
          pendingByType[row.job_type].oldest = row.created_at;
        }
      }

      const stuck: StuckJobType[] = [];
      for (const [jt, info] of Object.entries(pendingByType)) {
        // If this type HAS completions in 24h, it's working – skip
        if (completedTypes.has(jt)) continue;

        // If NONE of these pending jobs were ever attempted by the runner,
        // they're likely DAG-blocked – not a real blockade
        if (info.attempted === 0) continue;

        const ageMs = now - new Date(info.oldest).getTime();
        const ageHours = Math.round(ageMs / 3600000 * 10) / 10;

        stuck.push({ job_type: jt, pending: info.count, oldest_hours: ageHours });
      }

      return stuck.sort((a, b) => b.pending - a.pending);
    },
    refetchInterval: 60_000,
  });

  if (!stuckTypes || stuckTypes.length === 0) return null;

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Runner-Blockade erkannt</AlertTitle>
      <AlertDescription>
        <p className="text-xs mb-2">
          {stuckTypes.length} Job-Typ(en) mit attempted-but-stuck Jobs (0 Completions in 24h):
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {stuckTypes.map(s => (
            <div key={s.job_type} className="text-xs font-mono flex justify-between gap-2">
              <span className="truncate">{s.job_type}</span>
              <span className="text-destructive font-semibold whitespace-nowrap">
                {s.pending}× ({s.oldest_hours}h)
              </span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          <Info className="h-3 w-3 inline mr-1" />
          DAG-blockierte Jobs (nie vom Runner gestartet) werden nicht gezählt.
        </p>
      </AlertDescription>
    </Alert>
  );
}
