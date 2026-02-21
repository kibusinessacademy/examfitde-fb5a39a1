import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loading } from './OpsShared';

export default function QueueDashboard() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data } = await (supabase as any).from('job_queue')
      .select('*').order('created_at', { ascending: false }).limit(100);
    setJobs(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, []);
  if (loading) return <Loading />;

  const statusCounts = jobs.reduce((acc: any, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {});

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {['pending', 'processing', 'completed', 'failed'].map(s => (
          <Card key={s}>
            <CardContent className="py-3 px-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s}</p>
              <p className={cn("text-xl font-bold mt-1",
                s === 'failed' ? 'text-destructive' : s === 'completed' ? 'text-emerald-500' :
                s === 'processing' ? 'text-primary' : 'text-muted-foreground'
              )}>{statusCounts[s] || 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-2 px-3">Job Type</th>
              <th className="text-left py-2 px-3">Status</th>
              <th className="text-left py-2 px-3">Attempts</th>
              <th className="text-left py-2 px-3">Package</th>
              <th className="text-left py-2 px-3">Fehler</th>
              <th className="text-left py-2 px-3">Erstellt</th>
            </tr>
          </thead>
          <tbody>
            {jobs.slice(0, 50).map(j => (
              <tr key={j.id} className="border-b border-border/30 hover:bg-muted/30">
                <td className="py-2 px-3 font-mono">{j.job_type}</td>
                <td className="py-2 px-3">
                  <Badge variant="outline" className={cn("text-[10px]",
                    j.status === 'failed' ? 'bg-destructive/10 text-destructive' :
                    j.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600' :
                    j.status === 'processing' ? 'bg-primary/10 text-primary' : ''
                  )}>{j.status}</Badge>
                </td>
                <td className="py-2 px-3">{j.attempts}/{j.max_attempts}</td>
                <td className="py-2 px-3 font-mono text-muted-foreground truncate max-w-[120px]">
                  {j.payload?.package_id?.substring(0, 8) || '–'}
                </td>
                <td className="py-2 px-3 text-destructive truncate max-w-[200px]">{j.last_error || '–'}</td>
                <td className="py-2 px-3 text-muted-foreground">
                  {new Date(j.created_at).toLocaleString('de-DE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
