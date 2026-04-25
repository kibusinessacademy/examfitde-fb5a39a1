import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pause, Play, Square, Eye } from 'lucide-react';
import { toast } from 'sonner';

export default function CampaignsTab() {
  const queryClient = useQueryClient();

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['marketing-campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const updateCampaign = useMutation({
    mutationFn: async ({ id, status, stop_reason }: { id: string; status: string; stop_reason?: string }) => {
      const updates: TablesUpdate<'marketing_campaigns'> = { status };
      if (status === 'live') updates.started_at = new Date().toISOString();
      if (status === 'stopped') {
        updates.stopped_at = new Date().toISOString();
        updates.stop_reason = stop_reason || 'Admin-Entscheidung';
      }
      const { error } = await supabase.from('marketing_campaigns').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-campaigns'] });
      toast.success('Kampagne aktualisiert');
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const liveCampaigns = campaigns?.filter(c => c.status === 'live') || [];
  const totalBudgetSpent = campaigns?.reduce((s, c) => s + (c.budget_spent || 0), 0) || 0;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Live</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{liveCampaigns.length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Gesamt</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{campaigns?.length || 0}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Budget verbraucht</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{totalBudgetSpent.toFixed(2)}€</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Gestoppt</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-destructive">{campaigns?.filter(c => c.status === 'stopped').length || 0}</div></CardContent></Card>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kampagne</TableHead>
            <TableHead>Kanal</TableHead>
            <TableHead>Zielgruppen</TableHead>
            <TableHead>Budget</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Validierung</TableHead>
            <TableHead className="text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns?.map((c) => {
            const metrics = c.metrics as Record<string, number> || {};
            return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><Badge variant="outline">{c.channel}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {(c.target_groups as string[])?.map((g, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{g}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="font-mono">{c.budget_spent}/{c.budget_allocated}€</span>
                </TableCell>
                <TableCell>
                  <Badge variant={c.status === 'live' ? 'default' : c.status === 'stopped' ? 'destructive' : 'secondary'}>
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={c.validation_status === 'approved' ? 'default' : c.validation_status === 'rejected' ? 'destructive' : 'outline'}>
                    {c.validation_status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  {c.status === 'validated' && (
                    <Button size="icon" variant="ghost" onClick={() => updateCampaign.mutate({ id: c.id, status: 'live' })}>
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                  {c.status === 'live' && (
                    <>
                      <Button size="icon" variant="ghost" onClick={() => updateCampaign.mutate({ id: c.id, status: 'paused' })}>
                        <Pause className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => updateCampaign.mutate({ id: c.id, status: 'stopped', stop_reason: 'Admin Kill-Switch' })}>
                        <Square className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                  {c.status === 'paused' && (
                    <Button size="icon" variant="ghost" onClick={() => updateCampaign.mutate({ id: c.id, status: 'live' })}>
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {campaigns?.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                Noch keine Kampagnen
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
