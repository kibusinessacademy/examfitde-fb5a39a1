import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, CheckCircle, Clock, AlertTriangle, SkipForward } from 'lucide-react';
import { toast } from 'sonner';

interface RefreshItem {
  id: string;
  content_type: string;
  content_id: string;
  content_url: string | null;
  content_title: string | null;
  reason: string;
  priority: number;
  suggested_actions: any[];
  status: string;
  completed_at: string | null;
  created_at: string;
}

export default function RefreshQueueManager() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['seo-refresh-queue'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seo_refresh_queue' as any)
        .select('*').order('priority', { ascending: true }).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as RefreshItem[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const update: any = { status };
      if (status === 'completed') update.completed_at = new Date().toISOString();
      const { error } = await supabase.from('seo_refresh_queue' as any).update(update).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-refresh-queue'] });
      toast.success('Status aktualisiert');
    },
  });

  const pending = items.filter(i => i.status === 'pending');
  const inProgress = items.filter(i => i.status === 'in_progress');
  const completed = items.filter(i => i.status === 'completed');

  if (isLoading) return <Card><CardContent className="py-10"><Skeleton className="h-40 w-full" /></CardContent></Card>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-amber-500">{pending.length}</div>
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><Clock className="h-3 w-3" /> Ausstehend</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-blue-500">{inProgress.length}</div>
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><RefreshCw className="h-3 w-3" /> In Arbeit</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-emerald-500">{completed.length}</div>
          <div className="text-xs text-muted-foreground flex items-center justify-center gap-1"><CheckCircle className="h-3 w-3" /> Erledigt</div>
        </CardContent></Card>
      </div>

      <div className="space-y-2">
        {items.length === 0 && (
          <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">
            <CheckCircle className="h-6 w-6 mx-auto text-emerald-500 mb-2" />
            Keine Refresh-Kandidaten. Alle Inhalte sind aktuell.
          </CardContent></Card>
        )}
        {items.filter(i => i.status !== 'completed' && i.status !== 'skipped').map(item => (
          <Card key={item.id} className={`hover:border-primary/30 transition-colors ${item.priority <= 3 ? 'border-amber-500/30' : ''}`}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{item.content_title || item.content_url || item.content_id}</span>
                    <Badge variant="secondary" className="text-[10px]">{item.content_type}</Badge>
                    {item.priority <= 3 && <Badge className="text-[10px] bg-amber-500/15 text-amber-600">P{item.priority}</Badge>}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    <AlertTriangle className="h-3 w-3 inline mr-1" />
                    {item.reason}
                  </div>
                  {(item.suggested_actions as any[])?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(item.suggested_actions as any[]).map((a: any, i: number) => (
                        <Badge key={i} variant="outline" className="text-[10px]">
                          {typeof a === 'string' ? a : a.action || JSON.stringify(a)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  {item.status === 'pending' && (
                    <Button size="sm" variant="outline" className="h-6 text-[10px]"
                      onClick={() => updateStatus.mutate({ id: item.id, status: 'in_progress' })}>
                      Starten
                    </Button>
                  )}
                  {item.status === 'in_progress' && (
                    <Button size="sm" variant="outline" className="h-6 text-[10px]"
                      onClick={() => updateStatus.mutate({ id: item.id, status: 'completed' })}>
                      <CheckCircle className="h-3 w-3" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]"
                    onClick={() => updateStatus.mutate({ id: item.id, status: 'skipped' })}>
                    <SkipForward className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
