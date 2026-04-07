import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface StuckJobType {
  job_type: string;
  pending: number;
  oldest_hours: number;
}

export default function StuckJobTypeAlert() {
  const { data: stuckTypes } = useQuery({
    queryKey: ["stuck-job-types-alert"],
    queryFn: async () => {
      // Find job types with pending > 0 but 0 completions in 24h
      const { data: pending } = await supabase
        .from("job_queue")
        .select("job_type, created_at")
        .eq("status", "pending");

      if (!pending || pending.length === 0) return [];

      const { data: completed } = await supabase
        .from("job_queue")
        .select("job_type")
        .eq("status", "completed")
        .gte("completed_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const completedTypes = new Set((completed ?? []).map(r => r.job_type));

      // Group pending by type
      const pendingByType: Record<string, { count: number; oldest: string }> = {};
      for (const row of pending) {
        if (!pendingByType[row.job_type]) {
          pendingByType[row.job_type] = { count: 0, oldest: row.created_at };
        }
        pendingByType[row.job_type].count++;
        if (row.created_at < pendingByType[row.job_type].oldest) {
          pendingByType[row.job_type].oldest = row.created_at;
        }
      }

      // Filter: pending > 0, completed_24h = 0, oldest > 1h
      const stuck: StuckJobType[] = [];
      for (const [jt, info] of Object.entries(pendingByType)) {
        if (completedTypes.has(jt)) continue;
        const ageMs = Date.now() - new Date(info.oldest).getTime();
        const ageHours = Math.round(ageMs / 3600000 * 10) / 10;
        if (ageHours < 1) continue; // ignore very fresh jobs
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
      <AlertTitle>Runner-Claiming-Blockade erkannt</AlertTitle>
      <AlertDescription>
        <p className="text-xs mb-2">
          {stuckTypes.length} Job-Typ(en) mit pending Jobs aber 0 Completions in 24h:
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
      </AlertDescription>
    </Alert>
  );
}
