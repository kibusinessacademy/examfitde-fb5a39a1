import { useEffect, useState, useRef } from 'react';
import { Copy, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

export default function LiveLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data } = await (supabase as any).from('job_queue')
      .select('id, job_type, status, last_error, created_at, payload')
      .order('created_at', { ascending: false }).limit(200);
    setLogs(data || []);
  };

  useEffect(() => { load(); const i = setInterval(load, 2000); return () => clearInterval(i); }, []);

  const filtered = filter === 'all' ? logs :
    filter === 'error' ? logs.filter(l => l.status === 'failed') :
    filter === 'warn' ? logs.filter(l => l.status === 'processing') :
    logs.filter(l => l.status === 'completed');

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(filtered.slice(0, 50), null, 2));
    toast.success('Logs kopiert');
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `ops-logs-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1">
          {['all', 'error', 'warn', 'ok'].map(f => (
            <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'}
              className="h-7 text-xs" onClick={() => setFilter(f)}>
              {f}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={handleCopy}><Copy className="h-3 w-3" /></Button>
          <Button size="sm" variant="ghost" onClick={handleDownload}><Download className="h-3 w-3" /></Button>
        </div>
      </div>
      <ScrollArea className="h-[600px] rounded-md border bg-card p-3">
        <div className="space-y-0.5 font-mono text-[11px]">
          {filtered.map((log: any) => (
            <div key={log.id} className={cn("flex items-start gap-2 py-0.5",
              log.status === 'failed' && 'text-destructive',
              log.status === 'completed' && 'text-emerald-500/80'
            )}>
              <span className="text-muted-foreground shrink-0 w-[44px]">
                {new Date(log.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={cn("shrink-0 w-12",
                log.status === 'failed' ? 'text-destructive' : log.status === 'completed' ? 'text-emerald-500' :
                log.status === 'processing' ? 'text-primary' : 'text-muted-foreground'
              )}>{log.status}</span>
              <span className="text-foreground">{log.job_type}</span>
              {log.last_error && <span className="text-destructive truncate max-w-[300px]">– {log.last_error}</span>}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
