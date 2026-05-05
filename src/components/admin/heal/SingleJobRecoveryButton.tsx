/**
 * Admin button to trigger targeted artifact-aware recovery + step sync
 * for a single job ID. Shows the before/after diff returned by the
 * `admin_recover_single_job` RPC.
 */
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Wrench, CheckCircle2, AlertCircle } from 'lucide-react';

interface DiffChange {
  field: string;
  before: unknown;
  after: unknown;
}

interface RecoveryResult {
  ok: boolean;
  job_id?: string;
  package_id?: string;
  step_key?: string;
  job_type?: string;
  changes?: DiffChange[];
  no_op?: boolean;
  job_status?: string;
  step_status?: string | null;
  recovered_at?: string;
  error?: string;
}

interface Props {
  jobId: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'default';
  label?: string;
}

export function SingleJobRecoveryButton({ jobId, variant = 'outline', size = 'sm', label = 'Targeted Recovery' }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const { toast } = useToast();

  const handleRun = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc('admin_recover_single_job', { p_job_id: jobId });
      if (error) throw error;
      const res = data as unknown as RecoveryResult;
      setResult(res);
      if (res.ok) {
        toast({
          title: res.no_op ? 'No changes detected' : 'Recovery applied',
          description: res.no_op
            ? 'Job and step were already in sync.'
            : `${res.changes?.length ?? 0} field(s) changed.`,
        });
      } else {
        toast({ title: 'Recovery failed', description: res.error ?? 'Unknown error', variant: 'destructive' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ ok: false, error: msg });
      toast({ title: 'Recovery error', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          <Wrench className="h-4 w-4 mr-1.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Targeted Job Recovery</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="text-muted-foreground">
            Re-runs artifact-aware lock release and step sync for job:
            <code className="ml-2 text-xs">{jobId}</code>
          </div>

          {!result && (
            <Button onClick={handleRun} disabled={loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
              Run Recovery
            </Button>
          )}

          {result && result.ok && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {result.no_op ? (
                  <Badge variant="secondary"><CheckCircle2 className="h-3 w-3 mr-1" />No-op</Badge>
                ) : (
                  <Badge className="bg-success text-success-foreground">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    {result.changes?.length ?? 0} change(s)
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {result.job_type} → step <code>{result.step_key}</code>
                </span>
              </div>

              {!result.no_op && result.changes && result.changes.length > 0 && (
                <div className="border rounded-md divide-y">
                  {result.changes.map((c, i) => (
                    <div key={i} className="p-2.5 text-xs">
                      <div className="font-mono font-medium text-foreground mb-1">{c.field}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-muted-foreground text-[10px] uppercase">Before</div>
                          <div className="font-mono break-all">{String(c.before ?? '∅')}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-[10px] uppercase">After</div>
                          <div className="font-mono break-all text-success">{String(c.after ?? '∅')}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Job status: <code>{result.job_status}</code>
                {result.step_status && <> · Step status: <code>{result.step_status}</code></>}
              </div>
            </div>
          )}

          {result && !result.ok && (
            <div className="flex items-start gap-2 p-3 border border-destructive/40 bg-destructive-bg-subtle rounded-md text-sm">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-destructive">Recovery failed</div>
                <div className="text-xs mt-1">{result.error}</div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {result && (
            <Button variant="outline" size="sm" onClick={() => { setResult(null); }}>
              Run Again
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
