import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { 
  AlertCircle, Clock, CheckCircle, ArrowRight, Search, Filter,
  HelpCircle, AlertTriangle, HeartCrack, Lightbulb, CreditCard
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useState } from 'react';

const TICKET_TYPE_ICONS: Record<string, React.ElementType> = {
  verstaendnisfrage: HelpCircle,
  technisch: AlertTriangle,
  pruefungsangst: HeartCrack,
  lernstrategie: Lightbulb,
  abrechnung: CreditCard,
  general: HelpCircle,
};

const SENTIMENT_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  anxious: { label: '😟 Ängstlich', variant: 'destructive' },
  frustrated: { label: '😤 Frustriert', variant: 'destructive' },
  overwhelmed: { label: '😵 Überfordert', variant: 'destructive' },
  neutral: { label: 'Neutral', variant: 'outline' },
  positive: { label: '😊 Positiv', variant: 'default' },
};

export default function SupportTicketList() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['support-tickets-smart', statusFilter, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (searchQuery) {
        query = query.ilike('subject', `%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === 'resolved') updates.resolved_at = new Date().toISOString();
      
      const { error } = await supabase
        .from('support_tickets')
        .update(updates as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-tickets-smart'] });
      toast.success('Status aktualisiert');
    }
  });

  // Stats
  const openCount = tickets?.filter(t => t.status === 'open').length || 0;
  const inProgressCount = tickets?.filter(t => t.status === 'in_progress').length || 0;
  const anxiousCount = tickets?.filter(t => (t as any).sentiment === 'anxious' || (t as any).sentiment === 'frustrated').length || 0;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open': return <AlertCircle className="h-4 w-4 text-orange-500" />;
      case 'in_progress': return <Clock className="h-4 w-4 text-blue-500" />;
      case 'resolved': return <CheckCircle className="h-4 w-4 text-green-500" />;
      default: return <ArrowRight className="h-4 w-4" />;
    }
  };

  const getPriorityVariant = (p: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (p === 'urgent' || p === 'high') return 'destructive';
    if (p === 'medium') return 'secondary';
    return 'outline';
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card border-orange-500/30 bg-orange-500/5">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Offen</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-orange-500">{openCount}</div></CardContent>
        </Card>
        <Card className="glass-card border-blue-500/30 bg-blue-500/5">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">In Bearbeitung</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-blue-500">{inProgressCount}</div></CardContent>
        </Card>
        <Card className="glass-card border-pink-500/30 bg-pink-500/5">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Emotional kritisch</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-pink-500">{anxiousCount}</div></CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Gesamt</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{tickets?.length || 0}</div></CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Ticket suchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="open">Offen</SelectItem>
            <SelectItem value="in_progress">In Bearbeitung</SelectItem>
            <SelectItem value="waiting">Wartend</SelectItem>
            <SelectItem value="resolved">Gelöst</SelectItem>
            <SelectItem value="closed">Geschlossen</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Ticket Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Support-Tickets</CardTitle>
          <CardDescription>Kontextuelles Ticketsystem mit Sentiment-Erkennung</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Betreff</TableHead>
                <TableHead>Stimmung</TableHead>
                <TableHead>Priorität</TableHead>
                <TableHead>Erstellt</TableHead>
                <TableHead className="text-right">Aktion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets?.map((ticket) => {
                const TypeIcon = TICKET_TYPE_ICONS[(ticket as any).ticket_type || 'general'] || HelpCircle;
                const sentimentInfo = SENTIMENT_LABELS[(ticket as any).sentiment || 'neutral'] || SENTIMENT_LABELS.neutral;
                
                return (
                  <TableRow key={ticket.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(ticket.status ?? 'open')}
                        <span className="capitalize text-sm">{ticket.status?.replace('_', ' ')}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs capitalize">{((ticket as any).ticket_type || 'general').replace('_', ' ')}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium max-w-xs truncate">{ticket.subject}</TableCell>
                    <TableCell>
                      <Badge variant={sentimentInfo.variant} className="text-xs">
                        {sentimentInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getPriorityVariant(ticket.priority || 'low')} className="capitalize text-xs">
                        {ticket.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {ticket.created_at ? format(new Date(ticket.created_at), 'dd.MM.yy HH:mm', { locale: de }) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Select
                        value={ticket.status ?? 'open'}
                        onValueChange={(v) => updateStatus.mutate({ id: ticket.id, status: v })}
                      >
                        <SelectTrigger className="w-32 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Offen</SelectItem>
                          <SelectItem value="in_progress">In Bearbeitung</SelectItem>
                          <SelectItem value="waiting">Wartend</SelectItem>
                          <SelectItem value="resolved">Gelöst</SelectItem>
                          <SelectItem value="closed">Geschlossen</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
              {tickets?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Keine Tickets gefunden
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
