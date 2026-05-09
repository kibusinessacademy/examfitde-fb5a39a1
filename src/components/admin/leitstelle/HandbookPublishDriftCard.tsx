/**
 * HandbookPublishDriftCard
 * ────────────────────────
 * Leitstellen-Karte: zeigt Pakete mit publishable, aber unpublished
 * Handbook-Chapters. Erlaubt SSOT-gated Backfill (Dry-Run / Apply).
 *
 * Datenpfad: admin_get_handbook_publish_drift_summary (SECURITY DEFINER + has_role)
 * Mutation:  admin_backfill_publishable_handbook_chapters(p_dry_run, p_package_id)
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BookOpen, AlertTriangle, CheckCircle2, PlayCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Offender = {
  package_id: string;
  package_title: string;
  chapter_count: number;
  published_count: number;
  publishable_count: number;
  blocker_reason: string;
};

type Summary = {
  drift_packages: number;
  chapters_publishable_pending: number;
  top_offenders: Offender[];
};

export function HandbookPublishDriftCard() {
  const qc = useQueryClient();
  const [lastResult, setLastResult] = useState<any>(null);

  const { data, isLoading, error, refetch } = useQuery<Summary>({
    queryKey: ['handbook-publish-drift-summary'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        'admin_get_handbook_publish_drift_summary'
      );
      if (error) throw error;
      return data as Summary;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const backfill = useMutation({
    mutationFn: async (vars: { dryRun: boolean; packageId?: string }) => {
      const { data, error } = await (supabase as any).rpc(
        'admin_backfill_publishable_handbook_chapters',
        { p_dry_run: vars.dryRun, p_package_id: vars.packageId ?? null }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (res, vars) => {
      setLastResult(res);
      toast.success(
        vars.dryRun
          ? `Dry-Run: ${res?.publishable_total ?? 0} Chapters bereit, ${res?.packages_affected ?? 0} Pakete betroffen`
          : `Backfill: ${res?.updated ?? 0} Chapters published (${res?.packages_affected ?? 0} Pakete)`
      );
      qc.invalidateQueries({ queryKey: ['handbook-publish-drift-summary'] });
      qc.invalidateQueries({ queryKey: ['handbook-chapters'] });
      refetch();
    },
    onError: (e: any) => {
      toast.error(`Fehler: ${e?.message ?? 'unbekannt'}`);
    },
  });

  if (isLoading) {
    return (
      <Card className="p-4 space-y-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-20" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> Handbook-Drift konnte nicht geladen werden
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Erneut versuchen
        </Button>
      </Card>
    );
  }

  const driftPackages = data?.drift_packages ?? 0;
  const pendingChapters = data?.chapters_publishable_pending ?? 0;
  const offenders = data?.top_offenders ?? [];
  const tone =
    driftPackages === 0 ? 'ok' : driftPackages >= 20 ? 'crit' : 'warn';

  const toneClass =
    tone === 'ok'
      ? 'border-success/30 bg-success-bg-subtle'
      : tone === 'warn'
      ? 'border-warning/30 bg-warning-bg-subtle'
      : 'border-destructive/30 bg-destructive-bg-subtle';

  const severity = tone === 'ok' ? 'OK' : tone === 'warn' ? 'P2' : 'P1';

  return (
    <Card className="p-4 space-y-3" data-testid="handbook-publish-drift">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Handbuch Publish-Drift
          </h2>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono">
            SSOT-gated
          </Badge>
          <Badge
            variant="outline"
            className={`text-[10px] h-4 px-1.5 ${
              tone === 'ok'
                ? 'border-success/30 text-success'
                : tone === 'warn'
                ? 'border-warning/30 text-warning'
                : 'border-destructive/30 text-destructive'
            }`}
          >
            {severity}
          </Badge>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={backfill.isPending || driftPackages === 0}
            onClick={() => backfill.mutate({ dryRun: true })}
          >
            {backfill.isPending && backfill.variables?.dryRun ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <PlayCircle className="h-3 w-3 mr-1" />
            )}
            Dry-Run
          </Button>
          <Button
            size="sm"
            disabled={backfill.isPending || driftPackages === 0}
            onClick={() => {
              if (
                !window.confirm(
                  `Backfill anwenden? Es werden bis zu ${pendingChapters} Chapters in ${driftPackages} Paketen auf published gesetzt (nur SSOT-publishable).`
                )
              )
                return;
              backfill.mutate({ dryRun: false });
            }}
          >
            {backfill.isPending && !backfill.variables?.dryRun ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <CheckCircle2 className="h-3 w-3 mr-1" />
            )}
            Apply
          </Button>
        </div>
      </div>

      <div className={`grid gap-3 md:grid-cols-2 rounded-xl border p-3 ${toneClass}`}>
        <Tile label="Pakete mit Drift" value={driftPackages} />
        <Tile label="Chapters pending" value={pendingChapters} />
      </div>

      <p className="text-[11px] text-muted-foreground leading-snug">
        Eligibility: Paket published · generate_handbook + validate_handbook done · Chapter
        hat Title + ≥1 Section mit Content · kein quality_block. Pipeline-Trigger
        veröffentlicht ab jetzt automatisch beim Übergang status→published.
      </p>

      {offenders.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-foreground">Top Offenders</div>
          <div className="rounded-lg border border-border divide-y divide-border max-h-64 overflow-auto">
            {offenders.map((o) => (
              <div
                key={o.package_id}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">
                    {o.package_title}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate">
                    {o.blocker_reason} · {o.published_count}/{o.publishable_count} published
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  disabled={backfill.isPending}
                  onClick={() =>
                    backfill.mutate({ dryRun: false, packageId: o.package_id })
                  }
                >
                  Heal
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {lastResult && (
        <div className="rounded-lg border border-border bg-muted/30 p-2 text-[10px] font-mono text-muted-foreground">
          Last action: dry_run={String(lastResult.dry_run)} · updated={lastResult.updated} ·
          packages={lastResult.packages_affected} · pending=
          {(lastResult.publishable_total ?? 0) - (lastResult.after_published ?? 0)}
        </div>
      )}
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-bold tabular-nums text-foreground">
        {value.toLocaleString('de-DE')}
      </span>
    </div>
  );
}
