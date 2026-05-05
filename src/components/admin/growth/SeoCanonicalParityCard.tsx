import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SEVERITY_COLOR: Record<string, string> = {
  OK: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  NEVER_CHECKED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  STALE_24H: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ORPHAN_PUBLISHED: "bg-destructive-bg-subtle text-destructive",
  DRAFT_BUT_PKG_LIVE: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
};

export default function SeoCanonicalParityCard() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const summary = useQuery({
    queryKey: ["admin-seo-canonical-drift-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_seo_canonical_drift_summary" as any);
      if (error) throw error;
      return (data ?? []) as Array<{ drift_severity: string; page_count: number }>;
    },
    refetchInterval: 60_000,
  });

  const runMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_seo_canonical_parity_run" as any);
      if (error) throw error;
      return data as { checked: number; orphan_demoted: number; ok: number };
    },
    onSuccess: (d) => {
      toast({
        title: "Canonical-Parity-Lauf abgeschlossen",
        description: `geprüft ${d.checked} · Orphans demoted ${d.orphan_demoted} · OK ${d.ok}`,
      });
      qc.invalidateQueries({ queryKey: ["admin-seo-canonical-drift-summary"] });
    },
    onError: (e: any) =>
      toast({ title: "Lauf fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" /> SEO ↔ Canonical Parity (SSOT)
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => runMut.mutate()} disabled={runMut.isPending}>
          {runMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          <span className="ml-1 text-xs">Jetzt prüfen</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Stündlicher Cron <code>seo-canonical-parity-hourly</code> setzt <code>last_canonical_check</code> + demoted
          Orphan-Pages automatisch auf draft.
        </p>
        <div className="flex flex-wrap gap-2">
          {summary.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {summary.data?.map((row) => (
            <Badge key={row.drift_severity} className={SEVERITY_COLOR[row.drift_severity] ?? ""}>
              {row.drift_severity}: {row.page_count}
            </Badge>
          ))}
          {summary.data && summary.data.length === 0 && (
            <span className="text-xs text-muted-foreground">Keine Daten.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
