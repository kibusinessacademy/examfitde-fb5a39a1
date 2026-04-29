/**
 * BlockedReasonDetailCard — listet blockierte Pakete mit letztem Step + Fehler-Snippet.
 * Ergänzt BlockedPackagesCard um Ursachen-Kontext.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertOctagon } from "lucide-react";

interface Row {
  package_id: string;
  title: string;
  blocked_at: string;
  last_step: string | null;
  last_error: string | null;
  failed_jobs_24h: number;
}

export function BlockedReasonDetailCard() {
  const q = useQuery({
    queryKey: ["admin-blocked-detail"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_blocked_packages_detail" as any);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 60_000,
  });

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <AlertOctagon className="h-4 w-4" /> Blocked-Pakete · Ursachen
          <span className="text-muted-foreground font-normal">· {(q.data ?? []).length}</span>
        </h3>
        <Badge variant="outline" className="text-[10px]">60s</Badge>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (q.data ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">Keine blockierten Pakete.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {q.data!.map((r) => (
            <div key={r.package_id} className="rounded border p-2.5 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold truncate">{r.title}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {r.failed_jobs_24h} fail/24h
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="font-mono text-[10px]">step:</span>
                <span className="font-mono">{r.last_step ?? "—"}</span>
              </div>
              {r.last_error && (
                <div className="text-destructive font-mono text-[10px] line-clamp-2 bg-destructive/5 p-1 rounded">
                  {r.last_error}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">
                blocked seit: {new Date(r.blocked_at).toLocaleString("de-DE")}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
