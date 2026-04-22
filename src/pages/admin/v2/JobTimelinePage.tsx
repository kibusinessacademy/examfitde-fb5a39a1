import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Clock, Activity, Shield, AlertTriangle, ListChecks, Search } from 'lucide-react';

interface TimelineRow {
  ts: string;
  kind: 'transition' | 'decision' | 'admin_action';
  job_id: string | null;
  job_type: string | null;
  package_id: string | null;
  old_status: string | null;
  new_status: string | null;
  error_class: string | null;
  last_error: string | null;
  trigger_source: string | null;
  attempts: number | null;
  decision: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
}

function relTime(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.round(d)}s`;
  if (d < 3600) return `${Math.round(d / 60)}m`;
  if (d < 86400) return `${(d / 3600).toFixed(1)}h`;
  return `${(d / 86400).toFixed(1)}d`;
}

function kindStyle(kind: string) {
  if (kind === 'transition') return { icon: Activity, cls: 'bg-primary/10 text-primary border-primary/30' };
  if (kind === 'decision') return { icon: Shield, cls: 'bg-accent/10 text-accent-foreground border-accent/30' };
  return { icon: AlertTriangle, cls: 'bg-warning/10 text-warning border-warning/30' };
}

function decisionStyle(d: string | null): string {
  if (!d) return 'text-muted-foreground';
  if (d === 'retry') return 'text-success';
  if (d.startsWith('skip_')) return 'text-warning';
  if (d.includes('terminal') || d.includes('cancel')) return 'text-destructive';
  return 'text-muted-foreground';
}

export default function JobTimelinePage() {
  const [params, setParams] = useSearchParams();
  const [jobIdInput, setJobIdInput] = useState(params.get('job_id') ?? '');
  const [pkgIdInput, setPkgIdInput] = useState(params.get('package_id') ?? '');
  const [errorClassFilter, setErrorClassFilter] = useState('');
  const jobId = params.get('job_id') || null;
  const pkgId = params.get('package_id') || null;

  const { data, isLoading, error } = useQuery({
    queryKey: ['job-timeline', jobId, pkgId],
    queryFn: async () => {
      if (!jobId && !pkgId) return [];
      const { data, error } = await supabase.rpc('admin_get_job_timeline' as any, {
        _job_id: jobId, _package_id: pkgId, _limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as unknown as TimelineRow[];
    },
    enabled: !!(jobId || pkgId),
    refetchInterval: 15_000,
  });

  const apply = () => {
    const next = new URLSearchParams();
    if (jobIdInput.trim()) next.set('job_id', jobIdInput.trim());
    if (pkgIdInput.trim()) next.set('package_id', pkgIdInput.trim());
    setParams(next);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Job Timeline</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Transitions · Retry-Decisions · Admin-Actions in chronologischer Sicht
        </p>
      </div>

      <Card className="border-border/70 bg-card/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Filter</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Input value={jobIdInput} onChange={(e) => setJobIdInput(e.target.value)}
            placeholder="job_id (UUID)" className="font-mono text-xs" />
          <Input value={pkgIdInput} onChange={(e) => setPkgIdInput(e.target.value)}
            placeholder="package_id (UUID)" className="font-mono text-xs" />
          <Button size="sm" onClick={apply}>
            <Search className="mr-1.5 h-3 w-3" /> Anzeigen
          </Button>
        </CardContent>
      </Card>

      {!jobId && !pkgId && (
        <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          Bitte job_id oder package_id eingeben.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {(error as Error).message}
        </div>
      )}

      {isLoading && <div className="text-xs text-muted-foreground">Lade…</div>}

      {data && data.length > 0 && (
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListChecks className="h-4 w-4 text-primary" />
              {data.length} Ereignisse
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative space-y-2 pl-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-px before:bg-border">
              {data.map((row, idx) => {
                const k = kindStyle(row.kind);
                const Icon = k.icon;
                return (
                  <div key={idx} className="relative">
                    <div className={cn('absolute -left-3.5 top-2 h-3 w-3 rounded-full border-2 bg-background',
                      row.kind === 'transition' && 'border-primary',
                      row.kind === 'decision' && 'border-accent',
                      row.kind === 'admin_action' && 'border-warning')} />
                    <div className="rounded-lg border border-border/60 bg-card px-3 py-2 text-xs">
                      <div className="flex items-start gap-2">
                        <Badge variant="outline" className={cn('h-5 shrink-0 gap-1 text-[10px]', k.cls)}>
                          <Icon className="h-2.5 w-2.5" /> {row.kind}
                        </Badge>
                        <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                          <Clock className="mr-1 inline h-2.5 w-2.5" />
                          {new Date(row.ts).toLocaleString('de-DE')} · vor {relTime(row.ts)}
                        </span>
                      </div>
                      <div className="mt-1.5 grid gap-1">
                        {row.kind === 'transition' && (
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{row.old_status ?? '—'} → <span className="font-bold text-foreground">{row.new_status}</span></span>
                            {row.error_class && <span className="font-mono text-destructive/80">{row.error_class}</span>}
                            <Badge variant="outline" className="ml-auto h-4 px-1 text-[9px]">{row.trigger_source}</Badge>
                          </div>
                        )}
                        {row.kind === 'decision' && (
                          <div className="flex items-center gap-2">
                            <span className={cn('font-mono font-semibold', decisionStyle(row.decision))}>
                              {row.decision}
                            </span>
                            {row.error_class && <span className="font-mono text-muted-foreground">{row.error_class}</span>}
                            {(row.payload as any)?.cooldown && (
                              <span className="text-[10px] text-muted-foreground">cooldown {(row.payload as any).cooldown}s</span>
                            )}
                          </div>
                        )}
                        {row.kind === 'admin_action' && (
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-warning">{row.decision}</span>
                            {row.old_status && row.new_status && (
                              <span className="font-mono">{row.old_status} → <span className="font-bold">{row.new_status}</span></span>
                            )}
                          </div>
                        )}
                        {row.last_error && (
                          <p className="line-clamp-2 font-mono text-[10px] text-destructive/80">{row.last_error}</p>
                        )}
                        {row.reason && (
                          <p className="text-[10px] italic text-muted-foreground">„{row.reason}"</p>
                        )}
                        {row.kind === 'decision' && (row.payload as any)?.checks && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {Object.entries((row.payload as any).checks as Record<string, boolean>).map(([k, v]) => (
                              <Badge key={k} variant="outline" className={cn('h-4 px-1 text-[9px]',
                                v ? 'border-success/30 text-success' : 'border-destructive/30 text-destructive')}>
                                {v ? '✓' : '✗'} {k}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      {row.job_id && (
                        <div className="mt-1 font-mono text-[9px] text-muted-foreground/60">
                          job {row.job_id.slice(0, 8)}{row.attempts != null && ` · ${row.attempts} attempts`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.length === 0 && (jobId || pkgId) && (
        <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          Keine Events gefunden.
        </div>
      )}
    </div>
  );
}
