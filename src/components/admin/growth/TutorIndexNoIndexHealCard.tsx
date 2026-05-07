import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Brain, AlertTriangle, RefreshCw, Play, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

type Item = {
  package_id: string;
  pkg_status: string;
  gate_class: string | null;
  build_step_status: string | null;
  validate_step_status: string | null;
  active_tutor_jobs: number;
  index_rows: number;
  approved_questions: number;
  eligibility:
    | 'eligible_build_missing'
    | 'defer_active_jobs'
    | 'defer_index_present_revalidate'
    | 'defer_no_artifacts';
};

type Forensics = {
  generated_at: string;
  summary: {
    total: number;
    eligible_build_missing: number;
    defer_active_jobs: number;
    defer_index_present_revalidate: number;
    defer_no_artifacts: number;
  };
  items: Item[];
};

const eligColor: Record<Item['eligibility'], string> = {
  eligible_build_missing: 'bg-warning-bg-subtle text-warning border-warning/40',
  defer_active_jobs: 'bg-surface-subtle text-muted-foreground border-border',
  defer_index_present_revalidate: 'bg-surface-subtle text-muted-foreground border-border',
  defer_no_artifacts: 'bg-surface-subtle text-muted-foreground border-border',
};

export default function TutorIndexNoIndexHealCard() {
  const { toast } = useToast();
  const [lastResult, setLastResult] = useState<{
    dry_run: boolean;
    eligible: number;
    jobs_enqueued: number;
    steps_nudged: number;
    skipped: number;
  } | null>(null);

  const forensicsQ = useQuery({
    queryKey: ['tutor-no-index-forensics'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('admin_get_tutor_index_no_index_forensics');
      if (error) throw error;
      return data as Forensics;
    },
    staleTime: 60_000,
  });

  const dryRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)('admin_heal_tutor_index_missing_build', { p_dry_run: true });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      setLastResult({ ...d, dry_run: true });
      toast({ title: 'Dry-Run abgeschlossen', description: `${d.eligible} eligible Pakete würden gehealt.` });
    },
    onError: (e: Error) => toast({ title: 'Dry-Run Fehler', description: e.message, variant: 'destructive' }),
  });

  const apply = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)('admin_heal_tutor_index_missing_build', { p_dry_run: false });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      setLastResult({ ...d, dry_run: false });
      toast({
        title: 'Heal angewendet',
        description: `${d.jobs_enqueued} Jobs enqueued · ${d.steps_nudged} Steps nudged · ${d.skipped} skipped.`,
      });
      forensicsQ.refetch();
    },
    onError: (e: Error) => toast({ title: 'Apply Fehler', description: e.message, variant: 'destructive' }),
  });

  const data = forensicsQ.data;
  const items = data?.items ?? [];
  const summary = data?.summary;
  const eligibleCount = summary?.eligible_build_missing ?? 0;

  return (
    <Card className="shadow-elev-1">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4 text-primary" />
            Tutor-Index · NO_INDEX_FOUND Forensik
            {summary && (
              <Badge variant="outline" className="text-[10px]">
                {summary.total} betroffen · {eligibleCount} eligible
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="mt-1 text-xs">
            Read-only Forensik + sicherer Heal-Bypass: nur eligible Pakete (build_step skipped + 0 index + ≥50 approved + keine aktiven Jobs).
          </CardDescription>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => forensicsQ.refetch()} disabled={forensicsQ.isLoading} className="gap-1">
            <RefreshCw className={`h-3.5 w-3.5 ${forensicsQ.isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" variant="secondary" onClick={() => dryRun.mutate()} disabled={dryRun.isPending} className="gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            {dryRun.isPending ? 'Dry-Run…' : 'Dry-Run'}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="default"
                disabled={apply.isPending || eligibleCount === 0}
                className="gap-1"
              >
                <Play className="h-3.5 w-3.5" />
                Heal {eligibleCount > 0 ? `(${eligibleCount})` : ''}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Heal anwenden?</AlertDialogTitle>
                <AlertDialogDescription>
                  Es werden <strong>{eligibleCount}</strong> Pakete genudged: build_ai_tutor_index → queued + Job enqueued
                  (idempotent pro Stunde). Audit in auto_heal_log. Keine Bronze-locked, keine aktiven Jobs.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={() => apply.mutate()}>Anwenden</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {forensicsQ.error && (
          <div className="rounded border border-destructive/30 bg-destructive-bg-subtle p-3 text-xs text-destructive">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" /> Fehler beim Laden
            </div>
            <div className="mt-1 opacity-80">{(forensicsQ.error as Error).message}</div>
          </div>
        )}

        {forensicsQ.isLoading && !forensicsQ.error && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        )}

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded border border-border/60 bg-surface-subtle p-2">
              <div className="text-muted-foreground">Eligible</div>
              <div className="text-lg font-semibold tabular-nums">{summary.eligible_build_missing}</div>
            </div>
            <div className="rounded border border-border/60 bg-surface-subtle p-2">
              <div className="text-muted-foreground">Defer · active</div>
              <div className="text-lg font-semibold tabular-nums">{summary.defer_active_jobs}</div>
            </div>
            <div className="rounded border border-border/60 bg-surface-subtle p-2">
              <div className="text-muted-foreground">Defer · index OK</div>
              <div className="text-lg font-semibold tabular-nums">{summary.defer_index_present_revalidate}</div>
            </div>
            <div className="rounded border border-border/60 bg-surface-subtle p-2">
              <div className="text-muted-foreground">Defer · no artifacts</div>
              <div className="text-lg font-semibold tabular-nums">{summary.defer_no_artifacts}</div>
            </div>
          </div>
        )}

        {lastResult && (
          <div className="rounded border border-primary/30 bg-primary/5 p-2 text-xs">
            <strong>{lastResult.dry_run ? 'Dry-Run' : 'Apply'}:</strong>{' '}
            eligible={lastResult.eligible} · enqueued={lastResult.jobs_enqueued} · nudged={lastResult.steps_nudged} · skipped={lastResult.skipped}
          </div>
        )}

        {items.length > 0 && (
          <ScrollArea className="h-[240px] rounded border border-border/60">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-subtle text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-medium">Package</th>
                  <th className="text-left p-2 font-medium">Build</th>
                  <th className="text-left p-2 font-medium">Validate</th>
                  <th className="text-center p-2 font-medium">Active</th>
                  <th className="text-center p-2 font-medium">Index</th>
                  <th className="text-center p-2 font-medium">Approved</th>
                  <th className="text-left p-2 font-medium">Eligibility</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.package_id} className="border-t border-border/40">
                    <td className="p-2 font-mono text-[11px] text-foreground truncate max-w-[180px]">{it.package_id}</td>
                    <td className="p-2 text-muted-foreground">{it.build_step_status ?? '—'}</td>
                    <td className="p-2 text-muted-foreground">{it.validate_step_status ?? '—'}</td>
                    <td className="p-2 text-center tabular-nums">{it.active_tutor_jobs}</td>
                    <td className="p-2 text-center tabular-nums">{it.index_rows}</td>
                    <td className="p-2 text-center tabular-nums">{it.approved_questions}</td>
                    <td className="p-2">
                      <Badge variant="outline" className={`text-[10px] ${eligColor[it.eligibility]}`}>
                        {it.eligibility.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
