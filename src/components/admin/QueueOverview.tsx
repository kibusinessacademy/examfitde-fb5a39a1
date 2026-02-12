import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Clock, Loader2, Package, Play, RefreshCw,
  CheckCircle2, XCircle, Zap, ListOrdered
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface QueueItem {
  id: string;
  title: string | null;
  status: string;
  build_progress: number;
  queue_position: number | null;
  created_at: string;
  integrity_passed: boolean;
  council_approved: boolean;
}

interface QueueStats {
  total: number;
  building: number;
  queued: number;
  completed: number;
  failed: number;
  pendingJobs: number;
  processingJobs: number;
}

export default function QueueOverview() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<QueueStats>({ total: 0, building: 0, queued: 0, completed: 0, failed: 0, pendingJobs: 0, processingJobs: 0 });
  const [loading, setLoading] = useState(true);

  const fetchQueue = async () => {
    try {
      const sb = supabase as any;

      // Active + queued packages
      const { data: pkgs } = await sb
        .from('course_packages')
        .select('id, title, status, build_progress, queue_position, created_at, integrity_passed, council_approved')
        .in('status', ['building', 'planning', 'council_review', 'qa', 'failed'])
        .order('queue_position', { ascending: true, nullsFirst: false });

      // Job queue stats
      const { data: jobs } = await sb
        .from('job_queue')
        .select('status')
        .in('status', ['pending', 'processing']);

      const packages = (pkgs || []) as QueueItem[];
      const jobList = (jobs || []) as { status: string }[];

      setItems(packages);
      setStats({
        total: packages.length,
        building: packages.filter(p => p.status === 'building').length,
        queued: packages.filter(p => p.queue_position && p.status !== 'building').length,
        completed: 0, // Not fetched in this query (published excluded)
        failed: packages.filter(p => p.status === 'failed').length,
        pendingJobs: jobList.filter(j => j.status === 'pending').length,
        processingJobs: jobList.filter(j => j.status === 'processing').length,
      });
    } catch (e) {
      console.error('QueueOverview load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
    // Auto-refresh every 10s if there's an active build
    const interval = setInterval(fetchQueue, 10000);
    return () => clearInterval(interval);
  }, []);

  const activeBuild = items.find(i => i.status === 'building');
  const queued = items.filter(i => i.queue_position && i.status !== 'building' && i.status !== 'failed');
  const failed = items.filter(i => i.status === 'failed');

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <ListOrdered className="h-4 w-4 text-muted-foreground" />
            Build-Warteschlange
          </span>
          <div className="flex items-center gap-2">
            {stats.processingJobs > 0 && (
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary">
                {stats.processingJobs} Job{stats.processingJobs !== 1 ? 's' : ''} aktiv
              </Badge>
            )}
            {stats.pendingJobs > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {stats.pendingJobs} wartend
              </Badge>
            )}
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setLoading(true); fetchQueue(); }}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Active Build */}
        {activeBuild && (
          <div className="border border-primary/30 bg-primary/5 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="relative">
                  <Loader2 className="h-4 w-4 text-primary animate-spin" />
                </div>
                <span className="text-sm font-medium truncate">{activeBuild.title || 'Kurspaket'}</span>
              </div>
              <Link to={`/admin/course/${activeBuild.id}`}>
                <Button variant="ghost" size="sm" className="h-6 text-xs">
                  Details <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <Progress value={activeBuild.build_progress} className="h-1.5 flex-1" />
              <span className="text-xs font-mono text-muted-foreground">{activeBuild.build_progress}%</span>
            </div>
          </div>
        )}

        {/* Queued */}
        {queued.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Warteschlange</p>
            {queued.map((item, i) => (
              <Link key={item.id} to={`/admin/course/${item.id}`} className="block">
                <div className="flex items-center justify-between gap-2 py-2 px-3 rounded-md hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-muted-foreground w-5 text-center">
                      #{item.queue_position ?? i + 1}
                    </span>
                    <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{item.title || item.id.substring(0, 12)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.council_approved && <CheckCircle2 className="h-3 w-3 text-success" />}
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  </div>
                </div>
              </Link>
            ))}
            {activeBuild && queued.length > 0 && (
              <p className="text-[10px] text-muted-foreground px-3">
                Geschätzte Wartezeit: ~{queued.length * 15} Min. (basierend auf Ø 15 Min/Paket)
              </p>
            )}
          </div>
        )}

        {/* Failed */}
        {failed.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-destructive">Fehlgeschlagen</p>
            {failed.map(item => (
              <Link key={item.id} to={`/admin/course/${item.id}`} className="block">
                <div className="flex items-center justify-between gap-2 py-2 px-3 rounded-md hover:bg-destructive/5 transition-colors border border-destructive/10">
                  <div className="flex items-center gap-2 min-w-0">
                    <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    <span className="text-sm truncate text-destructive">{item.title || item.id.substring(0, 12)}</span>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!activeBuild && queued.length === 0 && failed.length === 0 && (
          <div className="text-center py-4">
            <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-xs text-muted-foreground">Keine aktiven oder wartenden Builds</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
