/**
 * HandbookPublishDriftCard
 * ────────────────────────
 * Leitstellen-Karte: zeigt SSOT-gated Handbook-Publish-Drift inkl.
 * per-Track Policy, Backfill (Dry-Run/Apply), Rollback-Guard und Smoke-Test.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BookOpen, AlertTriangle, CheckCircle2, PlayCircle, Loader2, Undo2, FlaskConical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Offender = {
  package_id: string; package_title: string;
  track: string; allowed: boolean; required: boolean;
  chapter_count: number; published_count: number;
  publishable_count: number; blocker_reason: string;
};
type TrackPolicy = { track: string; allowed: boolean; required: boolean; requires_handbook?: boolean; gates: string[] };
type Summary = {
  drift_packages: number;
  chapters_publishable_pending: number;
  top_offenders: Offender[];
  policies: Record<string, TrackPolicy>;
  recent_actions: Array<{ action_type: string; result_status: string; target_id: string | null; created_at: string; metadata: any }>;
};

export function HandbookPublishDriftCard() {
  const qc = useQueryClient();
  const [lastResult, setLastResult] = useState<any>(null);
  const [confirmOpen, setConfirmOpen] = useState<null | { kind: 'apply' } | { kind: 'rollback'; pkg: Offender }>(null);
  const [rollbackReason, setRollbackReason] = useState('');

  const { data, isLoading, error, refetch } = useQuery<Summary>({
    queryKey: ['handbook-publish-drift-summary'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('admin_get_handbook_publish_drift_summary');
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
      const msg = String(e?.message ?? '');
      if (/forbidden|permission denied|42501/i.test(msg)) {
        toast.error('Backfill verweigert: Admin-/service-role-Rechte erforderlich.');
      } else {
        toast.error(`Fehler: ${msg || 'unbekannt'}`);
      }
    },
  });

  const rollback = useMutation({
    mutationFn: async (vars: { packageId: string; reason: string }) => {
      const { data, error } = await (supabase as any).rpc(
        'admin_rollback_handbook_chapters_publish',
        { p_package_id: vars.packageId, p_reason: vars.reason, p_chapter_ids: null }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (res) => {
      setLastResult(res);
      toast.success(`Rollback: ${res?.unpublished ?? 0} Chapters auf is_published=false gesetzt`);
      qc.invalidateQueries({ queryKey: ['handbook-publish-drift-summary'] });
      qc.invalidateQueries({ queryKey: ['handbook-chapters'] });
      refetch();
    },
    onError: (e: any) => toast.error(`Rollback fehlgeschlagen: ${e?.message ?? 'unbekannt'}`),
  });

  const smoke = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc('admin_smoke_handbook_publish_policy');
      if (error) throw error;
      return data;
    },
    onSuccess: (res) => {
      setLastResult(res);
      const failed = (res?.results ?? []).filter((r: any) => !r.pass);
      if (res?.pass) toast.success(`Smoke OK · ${(res?.results ?? []).length} Tests bestanden`);
      else toast.error(`Smoke FAILED · ${failed.length} Tests fehlgeschlagen`);
    },
    onError: (e: any) => {
      const msg = String(e?.message ?? '');
      if (/forbidden|permission denied|42501/i.test(msg)) {
        toast.error('Smoke verweigert: Diese Aktion erfordert Admin- oder service-role-Zugriff. Bitte als Admin einloggen.');
      } else {
        toast.error(`Smoke-Fehler: ${msg || 'unbekannt'}`);
      }
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
        <Button size="sm" variant="outline" onClick={() => refetch()}>Erneut versuchen</Button>
      </Card>
    );
  }

  const driftPackages = data?.drift_packages ?? 0;
  const pendingChapters = data?.chapters_publishable_pending ?? 0;
  const offenders = data?.top_offenders ?? [];
  const policies = data?.policies ?? {};
  const recent = data?.recent_actions ?? [];
  const tone = driftPackages === 0 ? 'ok' : driftPackages >= 20 ? 'crit' : 'warn';
  const toneClass =
    tone === 'ok' ? 'border-success/30 bg-success-bg-subtle'
      : tone === 'warn' ? 'border-warning/30 bg-warning-bg-subtle'
      : 'border-destructive/30 bg-destructive-bg-subtle';
  const severity = tone === 'ok' ? 'OK' : tone === 'warn' ? 'P2' : 'P1';

  return (
    <>
      <Card className="p-4 space-y-3" data-testid="handbook-publish-drift">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Handbuch Publish-Drift</h2>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono">SSOT-gated</Badge>
            <Badge
              variant="outline"
              className={`text-[10px] h-4 px-1.5 ${
                tone === 'ok' ? 'border-success/30 text-success'
                  : tone === 'warn' ? 'border-warning/30 text-warning'
                  : 'border-destructive/30 text-destructive'
              }`}
            >
              {severity}
            </Badge>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <Button size="sm" variant="outline" disabled={smoke.isPending} onClick={() => smoke.mutate()}>
              {smoke.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FlaskConical className="h-3 w-3 mr-1" />}
              Smoke
            </Button>
            <Button
              size="sm" variant="outline"
              disabled={backfill.isPending || driftPackages === 0}
              onClick={() => backfill.mutate({ dryRun: true })}
            >
              {backfill.isPending && backfill.variables?.dryRun
                ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                : <PlayCircle className="h-3 w-3 mr-1" />}
              Dry-Run
            </Button>
            <Button
              size="sm"
              disabled={backfill.isPending || driftPackages === 0}
              onClick={() => setConfirmOpen({ kind: 'apply' })}
            >
              {backfill.isPending && !backfill.variables?.dryRun
                ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                : <CheckCircle2 className="h-3 w-3 mr-1" />}
              Apply
            </Button>
          </div>
        </div>

        <div className={`grid gap-3 md:grid-cols-2 rounded-xl border p-3 ${toneClass}`}>
          <Tile label="Pakete mit Drift" value={driftPackages} />
          <Tile label="Chapters pending" value={pendingChapters} />
        </div>

        {/* Per-Track Policy */}
        <div className="space-y-1">
          <div className="text-xs font-medium text-foreground">Per-Track SSOT-Policy</div>
          <div className="grid gap-1.5 md:grid-cols-2">
            {Object.entries(policies).map(([track, p]) => (
              <div key={track} className="rounded-lg border border-border p-2 text-[11px] leading-snug">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-medium text-foreground">{track}</span>
                  <div className="flex gap-1">
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-4 px-1.5 ${
                        p.allowed ? 'border-success/30 text-success' : 'border-muted-foreground/30 text-muted-foreground'
                      }`}
                    >
                      {p.allowed ? 'allowed' : 'disallowed'}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] h-4 px-1.5 ${
                        p.required ? 'border-primary/30 text-primary' : 'border-muted-foreground/30 text-muted-foreground'
                      }`}
                    >
                      {p.required ? 'required' : 'optional'}
                    </Badge>
                  </div>
                </div>
                <div className="mt-1 text-muted-foreground font-mono break-words">
                  {p.gates.join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </div>

        {offenders.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-foreground">Top Offenders</div>
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="grid grid-cols-12 gap-1 px-3 py-1.5 text-[10px] font-mono text-muted-foreground bg-muted/30 border-b border-border">
                <div className="col-span-4">Paket</div>
                <div className="col-span-2">Track</div>
                <div className="col-span-1 text-center">Allow</div>
                <div className="col-span-1 text-center">Req</div>
                <div className="col-span-2 text-center">Pub / Pubable</div>
                <div className="col-span-2 text-right">Aktion</div>
              </div>
              <div className="divide-y divide-border max-h-64 overflow-auto">
                {offenders.map((o) => (
                  <div key={o.package_id} className="grid grid-cols-12 gap-1 px-3 py-1.5 text-xs items-center">
                    <div className="col-span-4 min-w-0">
                      <div className="truncate font-medium text-foreground">{o.package_title}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">{o.blocker_reason}</div>
                    </div>
                    <div className="col-span-2 text-[10px] font-mono text-muted-foreground truncate">{o.track}</div>
                    <div className="col-span-1 text-center">
                      <Badge variant="outline" className={`text-[9px] h-4 px-1 ${o.allowed ? 'border-success/30 text-success' : 'border-muted-foreground/30 text-muted-foreground'}`}>
                        {o.allowed ? 'Y' : 'N'}
                      </Badge>
                    </div>
                    <div className="col-span-1 text-center">
                      <Badge variant="outline" className={`text-[9px] h-4 px-1 ${o.required ? 'border-primary/30 text-primary' : 'border-muted-foreground/30 text-muted-foreground'}`}>
                        {o.required ? 'Y' : 'N'}
                      </Badge>
                    </div>
                    <div className="col-span-2 text-center text-[11px] tabular-nums font-mono">
                      <span className="text-foreground">{o.published_count}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-warning">{o.publishable_count}</span>
                    </div>
                    <div className="col-span-2 flex justify-end gap-1">
                      <Button
                        size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                        disabled={backfill.isPending}
                        onClick={() => backfill.mutate({ dryRun: false, packageId: o.package_id })}
                      >
                        Heal
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-destructive"
                        disabled={rollback.isPending || o.published_count === 0}
                        onClick={() => { setRollbackReason(''); setConfirmOpen({ kind: 'rollback', pkg: o }); }}
                      >
                        <Undo2 className="h-3 w-3 mr-1" />Rollback
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-foreground">Letzte Pipeline-Aktionen</div>
            <div className="rounded-lg border border-border divide-y divide-border max-h-40 overflow-auto text-[10px] font-mono">
              {recent.slice(0, 6).map((a, i) => (
                <div key={i} className="px-2 py-1 flex items-center justify-between gap-2">
                  <span className="truncate text-foreground">{a.action_type}</span>
                  <span className={a.result_status === 'success' ? 'text-success' : a.result_status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
                    {a.result_status}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(a.created_at).toLocaleString('de-DE')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {lastResult && (
          <div className="rounded-lg border border-border bg-muted/30 p-2 text-[10px] font-mono text-muted-foreground break-words">
            {JSON.stringify(lastResult).slice(0, 500)}
          </div>
        )}
      </Card>

      <AlertDialog open={!!confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(null)}>
        <AlertDialogContent>
          {confirmOpen?.kind === 'apply' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Backfill anwenden?</AlertDialogTitle>
                <AlertDialogDescription>
                  Es werden bis zu {pendingChapters} Chapters in {driftPackages} Paketen auf
                  is_published=true gesetzt — nur SSOT-publishable Chapters (Track erlaubt,
                  Steps done, Title + Content vorhanden, kein Quality-Block).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => { setConfirmOpen(null); backfill.mutate({ dryRun: false }); }}
                >
                  Apply
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {confirmOpen?.kind === 'rollback' && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Rollback: {confirmOpen.pkg.package_title}</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div>
                      Setzt alle <span className="font-mono text-foreground">{confirmOpen.pkg.published_count}</span> published Handbook-Chapters
                      dieses Pakets auf <span className="font-mono">is_published=false</span>.
                      Audit wird in <span className="font-mono">auto_heal_log</span> geschrieben.
                    </div>
                    <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-2 text-[11px] font-mono">
                      <div>Track: <span className="text-foreground">{confirmOpen.pkg.track}</span></div>
                      <div>Policy: <span className="text-foreground">{confirmOpen.pkg.allowed ? 'allowed' : 'disallowed'} · {confirmOpen.pkg.required ? 'required' : 'optional'}</span></div>
                      <div>Blocker: <span className="text-warning">{confirmOpen.pkg.blocker_reason}</span></div>
                      <div>Published / Publishable: <span className="text-foreground">{confirmOpen.pkg.published_count}</span> / <span className="text-warning">{confirmOpen.pkg.publishable_count}</span></div>
                    </div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                placeholder="Grund (mind. 5 Zeichen, Pflicht)"
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
                className="text-sm"
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  disabled={rollbackReason.trim().length < 5}
                  onClick={() => {
                    if (confirmOpen.kind !== 'rollback') return;
                    const pkgId = confirmOpen.pkg.package_id;
                    const reason = rollbackReason.trim();
                    setConfirmOpen(null);
                    rollback.mutate({ packageId: pkgId, reason });
                  }}
                >
                  Rollback ausführen
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
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
