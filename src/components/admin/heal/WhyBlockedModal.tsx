/**
 * "Why blocked?" modal — explains which guard prevented auto-publish for the
 * current package and lists the missing/incorrect meta fields per step.
 *
 * Data source: SECURITY DEFINER RPC `admin_check_publish_readiness`
 *   + `step_done_meta_audit` table (recent guard blocks).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';

interface ReadinessResponse {
  ok: boolean;
  ready?: boolean;
  package_title?: string;
  package_status?: string;
  reasons?: string[];
  steps_total?: number;
  steps_done?: number;
  open_steps?: Array<{
    step_key: string; status: string; last_error: string | null;
    attempts: number; updated_at: string;
  }>;
  meta_ok_drift?: Array<{
    step_key: string; meta_ok: string; meta_executed: string; updated_at: string;
  }>;
  recent_guard_blocks?: Array<{
    step_key: string; meta_ok: boolean; meta_executed: boolean;
    source_fn: string | null; created_at: string;
  }>;
}

interface WhyBlockedModalProps {
  packageId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhyBlockedModal({ packageId, open, onOpenChange }: WhyBlockedModalProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['publish-readiness', packageId],
    enabled: open && !!packageId,
    queryFn: async (): Promise<ReadinessResponse> => {
      const { data, error } = await supabase.rpc('admin_check_publish_readiness', {
        p_package_id: packageId!,
      });
      if (error) throw error;
      return data as unknown as ReadinessResponse;
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-warning" />
            Warum ist das Paket blockiert?
          </DialogTitle>
          <DialogDescription>
            {data?.package_title ?? 'Paket'} — Status: {data?.package_status ?? '…'}
          </DialogDescription>
        </DialogHeader>

        {isLoading && <div className="text-sm text-muted-foreground">Prüfe Readiness …</div>}

        {data && (
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {data.ready ? (
                  <Badge variant="default" className="bg-success text-success-foreground">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Publish-Ready
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <AlertTriangle className="w-3 h-3 mr-1" /> Nicht ready
                  </Badge>
                )}
                <span className="text-sm text-muted-foreground">
                  {data.steps_done} / {data.steps_total} Steps abgeschlossen
                </span>
              </div>

              {data.reasons && data.reasons.length > 0 && (
                <section>
                  <h3 className="font-semibold text-sm mb-2">Blockier-Gründe</h3>
                  <ul className="space-y-1">
                    {data.reasons.map((r) => (
                      <li key={r} className="text-sm flex items-start gap-2">
                        <span className="text-destructive">●</span>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{r}</code>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.meta_ok_drift && data.meta_ok_drift.length > 0 && (
                <section>
                  <h3 className="font-semibold text-sm mb-2 text-warning">
                    Steps mit Meta-OK Drift (done, aber meta.ok ≠ true)
                  </h3>
                  <div className="space-y-1">
                    {data.meta_ok_drift.map((s) => (
                      <div key={s.step_key} className="text-xs bg-warning-bg-subtle p-2 rounded">
                        <code>{s.step_key}</code> · meta.ok=<code>{s.meta_ok}</code>
                        {' · '}executed=<code>{s.meta_executed}</code>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {data.open_steps && data.open_steps.length > 0 && (
                <section>
                  <h3 className="font-semibold text-sm mb-2">Offene Steps</h3>
                  <div className="space-y-1">
                    {data.open_steps.map((s) => (
                      <div key={s.step_key} className="text-xs border border-border rounded p-2">
                        <div className="flex justify-between">
                          <code className="font-medium">{s.step_key}</code>
                          <Badge variant="outline" className="text-xs">{s.status}</Badge>
                        </div>
                        {s.last_error && (
                          <div className="text-destructive mt-1 break-all">{s.last_error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {data.recent_guard_blocks && data.recent_guard_blocks.length > 0 && (
                <section>
                  <h3 className="font-semibold text-sm mb-2">Letzte Guard-Blockaden</h3>
                  <div className="space-y-1">
                    {data.recent_guard_blocks.slice(0, 5).map((b, i) => (
                      <div key={i} className="text-xs border-l-2 border-destructive pl-2">
                        <code>{b.step_key}</code> ← <code>{b.source_fn ?? 'unknown'}</code>
                        <div className="text-muted-foreground">
                          {new Date(b.created_at).toLocaleString('de-DE')}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
