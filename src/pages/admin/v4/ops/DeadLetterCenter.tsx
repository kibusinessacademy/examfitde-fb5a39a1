import { useEffect, useState } from 'react';
import { CheckCircle2, RotateCcw, RefreshCw, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loading } from './OpsShared';

export default function DeadLetterCenter() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    const { data } = await (supabase as any).from('job_queue')
      .select('*').eq('status', 'failed').order('created_at', { ascending: false });
    setJobs(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleRetrySelected = async () => {
    if (selected.size === 0) return;
    await (supabase as any).from('job_queue')
      .update({ status: 'pending', attempts: 0, run_after: new Date().toISOString() })
      .in('id', Array.from(selected));
    toast.success(`${selected.size} Jobs werden erneut versucht`);
    setSelected(new Set());
    load();
  };

  const handleRetryAll = async () => {
    await (supabase as any).from('job_queue')
      .update({ status: 'pending', attempts: 0, run_after: new Date().toISOString() })
      .eq('status', 'failed');
    toast.success('Alle fehlgeschlagenen Jobs werden erneut versucht');
    load();
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `dead-letter-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">{jobs.length} fehlgeschlagene Jobs</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRetrySelected} disabled={selected.size === 0}>
            <RotateCcw className="h-3 w-3 mr-1" /> Auswahl retrien ({selected.size})
          </Button>
          <Button variant="outline" size="sm" onClick={handleRetryAll} disabled={jobs.length === 0}>
            <RefreshCw className="h-3 w-3 mr-1" /> Alle retrien
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            <Download className="h-3 w-3 mr-1" /> JSON
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {jobs.map(j => (
          <Card key={j.id} className={cn("border-l-4 border-l-destructive cursor-pointer transition-colors",
            selected.has(j.id) && "ring-2 ring-primary"
          )} onClick={() => {
            const next = new Set(selected);
            next.has(j.id) ? next.delete(j.id) : next.add(j.id);
            setSelected(next);
          }}>
            <CardContent className="py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-mono font-medium">{j.job_type}</span>
                <span className="text-xs text-muted-foreground">{j.attempts}/{j.max_attempts} Versuche</span>
              </div>
              {j.last_error && <p className="text-xs text-destructive mt-1 truncate">{j.last_error}</p>}
              <p className="text-[10px] text-muted-foreground mt-1">{new Date(j.created_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}</p>
            </CardContent>
          </Card>
        ))}
        {jobs.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
              Keine fehlgeschlagenen Jobs 🎉
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
