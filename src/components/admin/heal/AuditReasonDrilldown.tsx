import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';

interface DrilldownData {
  package_id: string;
  reason_substr: string | null;
  integrity_history: Array<{
    id: string;
    score: number | null;
    passed: boolean | null;
    hard_fail_reasons: string[] | null;
    trigger_source: string | null;
    job_id: string | null;
    created_at: string;
  }>;
  step_audit: Array<{
    id: string;
    step_key: string;
    blocked: boolean;
    block_reason: string | null;
    new_meta: Record<string, unknown> | null;
    prev_meta: Record<string, unknown> | null;
    source_fn: string | null;
    created_at: string;
  }>;
  notifications: Array<{
    id: string;
    title: string;
    body: string;
    severity: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
  fetched_at: string;
}

interface Props {
  packageId: string;
  reasonSubstr: string | null;
  onClose: () => void;
}

export function AuditReasonDrilldown({ packageId, reasonSubstr, onClose }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-reason-drilldown', packageId, reasonSubstr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_get_audit_reason_drilldown', {
        p_package_id: packageId,
        p_reason_substr: reasonSubstr ?? undefined,
        p_limit: 20,
      });
      if (error) throw error;
      return data as unknown as DrilldownData;
    },
    enabled: !!packageId,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Search className="inline w-4 h-4 mr-1" />
            Audit-Drilldown {reasonSubstr && <code className="text-sm ml-2">{reasonSubstr}</code>}
          </DialogTitle>
        </DialogHeader>

        {isLoading && <div className="text-sm text-muted-foreground">Lade …</div>}
        {error && <div className="text-sm text-destructive">{(error as Error).message}</div>}

        {data && (
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">
                integrity_check_history ({data.integrity_history.length})
              </CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.integrity_history.length === 0 && (
                  <div className="text-xs text-muted-foreground">Keine Einträge.</div>
                )}
                {data.integrity_history.map((h) => (
                  <div key={h.id} className="border rounded p-2 text-xs space-y-1">
                    <div className="flex gap-2 items-center">
                      <Badge variant={h.passed ? 'default' : 'destructive'}>
                        score={h.score} {h.passed ? 'pass' : 'fail'}
                      </Badge>
                      <span className="text-muted-foreground">
                        {new Date(h.created_at).toLocaleString('de-DE')}
                      </span>
                      <span className="text-muted-foreground">via {h.trigger_source ?? '—'}</span>
                    </div>
                    {h.hard_fail_reasons && h.hard_fail_reasons.length > 0 && (
                      <div>
                        <strong>hard_fail_reasons:</strong>
                        <ul className="ml-3 list-disc">
                          {h.hard_fail_reasons.map((r, i) => (
                            <li key={i}><code>{r}</code></li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">
                step_done_meta_audit ({data.step_audit.length})
              </CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.step_audit.length === 0 && (
                  <div className="text-xs text-muted-foreground">Keine Einträge.</div>
                )}
                {data.step_audit.slice(0, 5).map((a) => (
                  <div key={a.id} className="border rounded p-2 text-xs">
                    <div className="flex gap-2 items-center">
                      {a.blocked && <Badge variant="destructive">blocked</Badge>}
                      <code>{a.step_key}</code>
                      <span className="text-muted-foreground">{a.source_fn}</span>
                      <span className="text-muted-foreground ml-auto">
                        {new Date(a.created_at).toLocaleString('de-DE')}
                      </span>
                    </div>
                    {a.block_reason && (
                      <div className="mt-1 text-destructive">
                        <strong>block_reason:</strong> <code>{a.block_reason}</code>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">
                admin_notifications ({data.notifications.length})
              </CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.notifications.length === 0 && (
                  <div className="text-xs text-muted-foreground">Keine Einträge.</div>
                )}
                {data.notifications.slice(0, 5).map((n) => (
                  <div key={n.id} className="border rounded p-2 text-xs">
                    <div className="flex gap-2 items-center">
                      <Badge variant={n.severity === 'high' ? 'destructive' : 'secondary'}>
                        {n.severity}
                      </Badge>
                      <strong>{n.title}</strong>
                      <span className="text-muted-foreground ml-auto">
                        {new Date(n.created_at).toLocaleString('de-DE')}
                      </span>
                    </div>
                    <div className="mt-1">{n.body}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={onClose}>Schließen</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
