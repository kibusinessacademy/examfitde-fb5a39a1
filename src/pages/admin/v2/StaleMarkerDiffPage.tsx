/**
 * StaleMarkerDiffPage — listet alle Pakete mit Drift-Klassifikation
 * (v_admin_stale_marker_diff). Erlaubt selektive und Bulk-Bereinigung
 * stale Exhaustion-Marker mit optionalem Sofort-Refill.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, Sparkles, RefreshCcw, AlertTriangle } from 'lucide-react';
import { PurgeExhaustionButton } from '@/components/admin/heal/PurgeExhaustionButton';

type Row = {
  package_id: string;
  title: string | null;
  pkg_status: string | null;
  is_published: boolean | null;
  drift_class: string;
  recommended_action: string | null;
  open_steps: number | null;
  build_progress: number | null;
  exhaustion_markers: number | null;
  active_jobs: number | null;
  parked_jobs: number | null;
  failed_jobs: number | null;
  failed_steps: number | null;
  hard_stalled_steps: number | null;
  terminal_escalations: number | null;
  blocked_reason: string | null;
  integrity_score: number | null;
  last_step_update: string | null;
};

const DRIFT_VARIANT: Record<string, { label: string; tone: string }> = {
  STALE_EXHAUSTION_PUBLISHED: { label: 'Stale (published)', tone: 'bg-amber-500/15 text-amber-700 border-amber-500/30' },
  STALE_EXHAUSTION_NO_OPEN_STEPS: { label: 'Stale (no steps)', tone: 'bg-amber-500/15 text-amber-700 border-amber-500/30' },
  GHOST_PUBLISHED_FLAG_MISMATCH: { label: 'Ghost published', tone: 'bg-purple-500/15 text-purple-700 border-purple-500/30' },
  ORPHAN_BUILDING_NO_PROGRESS: { label: 'Orphan building', tone: 'bg-blue-500/15 text-blue-700 border-blue-500/30' },
  GHOST_BLOCKED_NO_FAILURE: { label: 'Ghost blocked', tone: 'bg-pink-500/15 text-pink-700 border-pink-500/30' },
  PARKED_AWAITING_PREREQ: { label: 'Parked', tone: 'bg-slate-500/15 text-slate-700 border-slate-500/30' },
  EXHAUSTED_BUT_STILL_RUNNING: { label: 'Exhausted+running', tone: 'bg-red-500/15 text-red-700 border-red-500/30' },
  CLEAN: { label: 'Clean', tone: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
};

export default function StaleMarkerDiffPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('STALE_ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRefill, setBulkRefill] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [autoPreselect, setAutoPreselect] = useState(true);
  // Tracks recently purged package_ids → for live job status panel
  const [trackedIds, setTrackedIds] = useState<string[]>([]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['stale-marker-diff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_admin_stale_marker_diff' as any)
        .select('*')
        .order('drift_class')
        .order('exhaustion_markers', { ascending: false } as any)
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    const rows = data ?? [];
    return rows.filter((r) => {
      if (filter === 'STALE_ALL' && !r.drift_class.startsWith('STALE_EXHAUSTION')) return false;
      if (filter !== 'STALE_ALL' && filter !== 'ALL' && r.drift_class !== filter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.title?.toLowerCase().includes(q) && !r.package_id.includes(q)) return false;
      }
      return true;
    });
  }, [data, filter, search]);

  const eligibleIds = useMemo(
    () =>
      filtered
        .filter((r) => r.drift_class.startsWith('STALE_EXHAUSTION') && (r.active_jobs ?? 0) === 0)
        .map((r) => r.package_id),
    [filtered],
  );
  const selectedEligible = eligibleIds.filter((id) => selected.has(id));

  // Auto-Preselect: alle eligible Pakete automatisch markieren wenn aktiviert.
  // Re-syncs whenever filter/data changes, ohne manuelle Auswahl zu zerstören
  // (Wir setzen nur den Snapshot der eligibles).
  useEffect(() => {
    if (!autoPreselect) return;
    setSelected((prev) => {
      const next = new Set(prev);
      // Add all currently eligible
      eligibleIds.forEach((id) => next.add(id));
      // Remove non-eligible (e.g. nach Refresh, weil active_jobs>0 wurde)
      Array.from(next).forEach((id) => {
        if (!eligibleIds.includes(id)) next.delete(id);
      });
      return next;
    });
  }, [autoPreselect, eligibleIds.join(',')]);

  const toggleAll = () => {
    if (selectedEligible.length === eligibleIds.length && eligibleIds.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligibleIds));
    }
  };

  const bulkMut = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      const results: Array<{ id: string; ok: boolean; error?: string; data?: any }> = [];
      for (const id of ids) {
        try {
          const { data, error } = await supabase.rpc('admin_purge_stale_exhaustion', {
            p_package_id: id,
            p_trigger_refill: bulkRefill,
          });
          if (error) throw error;
          results.push({ id, ok: true, data });
        } catch (e: any) {
          results.push({ id, ok: false, error: e?.message ?? String(e) });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      toast({
        title: 'Bulk-Bereinigung abgeschlossen',
        description: `${ok}/${results.length} bereinigt · ${fail} fehlgeschlagen${bulkRefill ? ' · Refill enqueued' : ''}`,
      });
      // Track all successfully purged ids for live-status panel (last 60 min retention via job query)
      const okIds = results.filter((r) => r.ok).map((r) => r.id);
      setTrackedIds((prev) => Array.from(new Set([...okIds, ...prev])).slice(0, 50));
      setSelected(new Set());
      setBulkOpen(false);
      qc.invalidateQueries({ queryKey: ['stale-marker-diff'] });
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['stale-marker-jobs'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Bulk-Fehler', description: err.message, variant: 'destructive' });
    },
  });

  // Live job-status: zeigt run_integrity_check (und Folge-Jobs) für tracked
  // package_ids. Wird alle 5s gepollt um schnell Status-Übergänge zu sehen.
  const { data: liveJobs } = useQuery({
    enabled: trackedIds.length > 0,
    queryKey: ['stale-marker-jobs', trackedIds.join(',')],
    queryFn: async () => {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data, error } = await (supabase as any)
        .from('job_queue')
        .select(
          'id,job_type,status,package_id,lane,priority,attempts,created_at,started_at,completed_at,run_after,last_error',
        )
        .in('package_id', trackedIds)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    refetchInterval: 5_000,
  });

  const counts = useMemo(() => {
    const rows = data ?? [];
    return {
      total: rows.length,
      stale: rows.filter((r) => r.drift_class.startsWith('STALE_EXHAUSTION')).length,
      ghost: rows.filter((r) => r.drift_class.startsWith('GHOST_')).length,
      orphan: rows.filter((r) => r.drift_class === 'ORPHAN_BUILDING_NO_PROGRESS').length,
      clean: rows.filter((r) => r.drift_class === 'CLEAN').length,
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div>
        <Link to="/admin/command" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
          <ArrowLeft className="h-3 w-3" /> Leitstelle
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Stale Marker Diff
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Drift-Erkennung pro Paket: Vergleich zwischen <code>pkg_status</code>, Published-Flag,
          aktiven Steps und Marker-/Audit-Einträgen.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Gesamt</div><div className="text-2xl font-bold">{counts.total}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Stale Exhaustion</div><div className="text-2xl font-bold text-amber-600">{counts.stale}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Ghost</div><div className="text-2xl font-bold text-purple-600">{counts.ghost}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Orphan Building</div><div className="text-2xl font-bold text-blue-600">{counts.orphan}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Clean</div><div className="text-2xl font-bold text-emerald-600">{counts.clean}</div></CardContent></Card>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[260px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="STALE_ALL">Nur Stale Exhaustion</SelectItem>
                <SelectItem value="ALL">Alle</SelectItem>
                <SelectItem value="STALE_EXHAUSTION_PUBLISHED">Stale (published)</SelectItem>
                <SelectItem value="STALE_EXHAUSTION_NO_OPEN_STEPS">Stale (no steps)</SelectItem>
                <SelectItem value="GHOST_PUBLISHED_FLAG_MISMATCH">Ghost published</SelectItem>
                <SelectItem value="ORPHAN_BUILDING_NO_PROGRESS">Orphan building</SelectItem>
                <SelectItem value="GHOST_BLOCKED_NO_FAILURE">Ghost blocked</SelectItem>
                <SelectItem value="PARKED_AWAITING_PREREQ">Parked awaiting prereq</SelectItem>
                <SelectItem value="EXHAUSTED_BUT_STILL_RUNNING">Exhausted+running</SelectItem>
                <SelectItem value="CLEAN">Clean</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suche Titel oder ID…"
              className="w-[240px] h-8 text-xs"
            />
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
              Reload
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {selectedEligible.length}/{eligibleIds.length} selektiert
              </span>
              <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
                <AlertDialogTrigger asChild>
                  <Button size="sm" disabled={selectedEligible.length === 0}>
                    <Sparkles className="h-3.5 w-3.5" />
                    Bulk Bereinigen ({selectedEligible.length})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{selectedEligible.length} Pakete bereinigen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Entfernt <code>HARD_FAIL_REPAIR_EXHAUSTED</code>-Marker bei stale Paketen
                      ohne aktive Jobs. Pakete mit aktiven Jobs werden vom RPC abgewiesen.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
                    <Checkbox id="bulk-refill" checked={bulkRefill} onCheckedChange={(v) => setBulkRefill(v === true)} />
                    <Label htmlFor="bulk-refill" className="text-xs leading-snug cursor-pointer">
                      <span className="font-medium">Sofort neu füllen</span>
                      <span className="block text-muted-foreground mt-0.5">
                        Enqueued pro Paket <code>run_integrity_check</code> (lane recovery).
                      </span>
                    </Label>
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={bulkMut.isPending}>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction onClick={(e) => { e.preventDefault(); bulkMut.mutate(); }} disabled={bulkMut.isPending}>
                      {bulkMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                      Bereinigen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Keine Pakete in dieser Drift-Klasse.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={eligibleIds.length > 0 && selectedEligible.length === eligibleIds.length}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Paket</TableHead>
                  <TableHead>Drift</TableHead>
                  <TableHead className="text-right">Marker</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                  <TableHead>Empfehlung</TableHead>
                  <TableHead className="text-right">Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const isStale = r.drift_class.startsWith('STALE_EXHAUSTION');
                  const isEligible = isStale && (r.active_jobs ?? 0) === 0;
                  const variant = DRIFT_VARIANT[r.drift_class] ?? { label: r.drift_class, tone: 'bg-muted text-muted-foreground' };
                  return (
                    <TableRow key={r.package_id} className={selected.has(r.package_id) ? 'bg-primary/5' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(r.package_id)}
                          disabled={!isEligible}
                          onCheckedChange={(v) => {
                            const next = new Set(selected);
                            if (v) next.add(r.package_id); else next.delete(r.package_id);
                            setSelected(next);
                          }}
                        />
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <div className="font-medium text-xs truncate">{r.title ?? '—'}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{r.package_id.slice(0, 8)}… · {r.pkg_status}{r.is_published ? ' · pub' : ''}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${variant.tone}`}>{variant.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs">{r.exhaustion_markers ?? 0}</TableCell>
                      <TableCell className="text-right text-xs">{r.open_steps ?? 0}</TableCell>
                      <TableCell className="text-right text-xs">{r.active_jobs ?? 0}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.recommended_action ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        {isStale ? (
                          <PurgeExhaustionButton
                            packageId={r.package_id}
                            packageTitle={r.title}
                            driftClass={r.drift_class}
                            recommendedAction={r.recommended_action}
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">n/a</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
