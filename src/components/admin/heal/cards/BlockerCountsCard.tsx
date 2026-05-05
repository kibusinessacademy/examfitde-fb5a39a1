/**
 * BlockerCountsCard — 4 echte Publish-Blocker als Klick-Filter.
 * Source: View v_admin_blocker_dashboard
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Clock, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

export type BlockerKey =
  | "INTEGRITY_NEVER_CHECKED"
  | "INTEGRITY_DEFERRED"
  | "QUALITY_COUNCIL_PENDING"
  | "EXAM_POOL_TOO_SMALL";

export const BLOCKER_META: Record<BlockerKey, { label: string; icon: any; tone: string }> = {
  INTEGRITY_NEVER_CHECKED: { label: "Never Checked", icon: Clock, tone: "bg-muted text-muted-foreground" },
  INTEGRITY_DEFERRED: { label: "Deferred", icon: Pause, tone: "bg-secondary text-secondary-foreground" },
  QUALITY_COUNCIL_PENDING: { label: "Council Pending", icon: Clock, tone: "bg-secondary text-secondary-foreground" },
  EXAM_POOL_TOO_SMALL: { label: "Exam Pool Too Small", icon: AlertTriangle, tone: "bg-destructive-bg-subtle text-destructive" },
};

export interface DashboardRow {
  package_id: string;
  curriculum_id: string | null;
  course_title: string | null;
  curriculum_title: string | null;
  package_track: string | null;
  package_status: string | null;
  primary_blocker: BlockerKey;
  integrity_passed: boolean | null;
  approved_exam_questions: number | null;
  defer_reason: string | null;
  reason_code: string | null;
  quality_council_status: string | null;
  updated_at: string | null;
}

export function useBlockerDashboard() {
  return useQuery({
    queryKey: ["blocker-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_admin_blocker_dashboard" as any)
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as DashboardRow[];
    },
    refetchInterval: 30_000,
  });
}

interface Props {
  filter: BlockerKey | "ALL";
  onFilterChange: (next: BlockerKey | "ALL") => void;
}

export function BlockerCountsCard({ filter, onFilterChange }: Props) {
  const dashboard = useBlockerDashboard();
  const counts = useMemo(() => {
    const c: Record<BlockerKey, number> = {
      INTEGRITY_NEVER_CHECKED: 0,
      INTEGRITY_DEFERRED: 0,
      QUALITY_COUNCIL_PENDING: 0,
      EXAM_POOL_TOO_SMALL: 0,
    };
    (dashboard.data ?? []).forEach((r) => {
      if (c[r.primary_blocker] !== undefined) c[r.primary_blocker]++;
    });
    return c;
  }, [dashboard.data]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {(Object.keys(BLOCKER_META) as BlockerKey[]).map((k) => {
        const meta = BLOCKER_META[k];
        const Icon = meta.icon;
        const active = filter === k;
        return (
          <button
            key={k}
            onClick={() => onFilterChange(active ? "ALL" : k)}
            className={cn(
              "text-left p-3 rounded-lg border bg-card transition-all hover:shadow-sm",
              active && "ring-2 ring-primary",
            )}
            data-testid={`blocker-count-${k}`}
          >
            <div className="flex items-center justify-between">
              <span className={cn("p-1.5 rounded", meta.tone)}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-2xl font-bold tabular-nums">{counts[k]}</span>
            </div>
            <div className="mt-1.5 text-xs font-medium">{meta.label}</div>
            <div className="text-[10px] text-muted-foreground">{k}</div>
          </button>
        );
      })}
    </div>
  );
}
