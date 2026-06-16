import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ShieldAlert } from "lucide-react";

interface PreBrief {
  similar_rejected_30d: number;
  ineffective_repairs_14d: number;
  warnings: Array<{ level: string; code: string; message: string }>;
}

/**
 * KIMI.INTELLIGENCE.5 — Council Pre-Brief Note (read-only)
 * Zeigt vor dem Council-Lauf Warnungen, wenn ähnliche Coverage-Muster
 * zuvor abgelehnt wurden oder Repairs in 14d wirkungslos waren.
 */
export function CouncilPreBriefNote({ packageId }: { packageId: string }) {
  const [data, setData] = useState<PreBrief | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: res, error } = await supabase.rpc("admin_get_council_prebrief" as any, {
        p_package_id: packageId,
      });
      if (cancelled) return;
      if (!error && res) setData(res as PreBrief);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [packageId]);

  if (loading || !data || !data.warnings?.length) return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
        <ShieldAlert className="h-3 w-3" /> KIMI Pre-Brief
      </div>
      {data.warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-600" />
          <span>{w.message}</span>
        </div>
      ))}
      <div className="text-[10px] text-muted-foreground/70 pt-1 border-t border-amber-500/20">
        read-only · 30d rejections: {data.similar_rejected_30d} · 14d ineffective: {data.ineffective_repairs_14d}
      </div>
    </div>
  );
}
