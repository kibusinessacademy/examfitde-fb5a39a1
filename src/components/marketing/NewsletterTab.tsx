import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Eye, Edit } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function NewsletterTab() {
  const { data: subscribers, isLoading: loadingSubs } = useQuery({
    queryKey: ['newsletter-subscribers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('newsletter_subscribers')
        .select('*')
        .order('subscribed_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    }
  });

  const { data: campaigns, isLoading: loadingCampaigns } = useQuery({
    queryKey: ['email-campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    }
  });

  if (loadingSubs || loadingCampaigns) return <Skeleton className="h-64 w-full" />;

  const activeSubscribers = subscribers?.filter(s => s.is_subscribed).length || 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Aktive Abonnenten</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{activeSubscribers}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Kampagnen</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{campaigns?.length || 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Geplant</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{campaigns?.filter(c => c.status === 'scheduled').length || 0}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>E-Mail Kampagnen</CardTitle>
            <CardDescription>Newsletter und Kampagnen</CardDescription>
          </div>
          <Button><Plus className="h-4 w-4 mr-2" /> Neue Kampagne</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kampagne</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Gesendet</TableHead>
                <TableHead>Öffnungsrate</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns?.map((campaign) => {
                const stats = campaign.stats as { sent?: number; opened?: number } || {};
                const openRate = stats.sent ? Math.round((stats.opened || 0) / stats.sent * 100) : 0;
                return (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium">{campaign.name}</TableCell>
                    <TableCell>
                      <Badge variant={
                        campaign.status === 'sent' ? 'default' :
                        campaign.status === 'scheduled' ? 'secondary' :
                        campaign.status === 'draft' ? 'outline' : 'destructive'
                      }>
                        {campaign.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {campaign.sent_at
                        ? format(new Date(campaign.sent_at), 'dd.MM.yyyy HH:mm', { locale: de })
                        : '-'}
                    </TableCell>
                    <TableCell>{openRate}%</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon"><Eye className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon"><Edit className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {campaigns?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Noch keine Kampagnen erstellt
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
