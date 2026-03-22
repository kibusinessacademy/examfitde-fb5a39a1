import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Building2, Users, DollarSign, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const statusColors: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  new: 'outline',
  contacted: 'secondary',
  demo_scheduled: 'secondary',
  demo_done: 'default',
  proposal_sent: 'default',
  negotiation: 'default',
  closed_won: 'default',
  closed_lost: 'destructive',
};

const statusLabels: Record<string, string> = {
  new: 'Neu',
  contacted: 'Kontaktiert',
  demo_scheduled: 'Demo geplant',
  demo_done: 'Demo erledigt',
  proposal_sent: 'Angebot gesendet',
  negotiation: 'Verhandlung',
  closed_won: 'Gewonnen ✅',
  closed_lost: 'Verloren ❌',
};

export default function B2BLeadsTab() {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newLead, setNewLead] = useState({
    company_name: '',
    contact_name: '',
    contact_email: '',
    azubi_count: '',
    source: 'website',
    notes: '',
  });

  const { data: leads, isLoading } = useQuery({
    queryKey: ['b2b-leads', filterStatus],
    queryFn: async () => {
      let query = supabase
        .from('b2b_leads')
        .select('*')
        .order('created_at', { ascending: false });
      if (filterStatus !== 'all') query = query.eq('status', filterStatus);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['b2b-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.from('b2b_leads').select('status, deal_value_eur');
      if (error) throw error;
      const total = data.length;
      const won = data.filter(l => l.status === 'closed_won');
      const pipeline = data.filter(l => !['closed_won', 'closed_lost'].includes(l.status));
      return {
        total,
        pipelineCount: pipeline.length,
        wonCount: won.length,
        pipelineValue: pipeline.reduce((s, l) => s + (l.deal_value_eur || 0), 0),
        wonValue: won.reduce((s, l) => s + (l.deal_value_eur || 0), 0),
      };
    },
  });

  const addLead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('b2b_leads').insert({
        company_name: newLead.company_name,
        contact_name: newLead.contact_name || null,
        contact_email: newLead.contact_email || null,
        azubi_count: newLead.azubi_count ? parseInt(newLead.azubi_count) : null,
        source: newLead.source as any,
        notes: newLead.notes || null,
        status: 'new',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['b2b-leads'] });
      queryClient.invalidateQueries({ queryKey: ['b2b-stats'] });
      toast.success('Lead hinzugefügt');
      setShowAddDialog(false);
      setNewLead({ company_name: '', contact_name: '', contact_email: '', azubi_count: '', source: 'website', notes: '' });
    },
    onError: () => toast.error('Fehler beim Hinzufügen'),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('b2b_leads').update({
        status,
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['b2b-leads'] });
      queryClient.invalidateQueries({ queryKey: ['b2b-stats'] });
      toast.success('Status aktualisiert');
    },
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Gesamt Leads', value: stats?.total || 0, icon: Building2 },
          { label: 'In Pipeline', value: stats?.pipelineCount || 0, icon: TrendingUp },
          { label: 'Pipeline-Wert', value: `${(stats?.pipelineValue || 0).toFixed(0)}€`, icon: DollarSign },
          { label: 'Gewonnen', value: `${(stats?.wonValue || 0).toFixed(0)}€`, icon: Users },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
              <s.icon className="h-5 w-5 text-primary" />
              <div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="text-xl font-bold">{s.value}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Controls */}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            {Object.entries(statusLabels).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Lead hinzufügen</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Neuen B2B Lead anlegen</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Unternehmen *</Label>
                <Input value={newLead.company_name} onChange={e => setNewLead(p => ({ ...p, company_name: e.target.value }))} />
              </div>
              <div>
                <Label>Ansprechpartner</Label>
                <Input value={newLead.contact_name} onChange={e => setNewLead(p => ({ ...p, contact_name: e.target.value }))} />
              </div>
              <div>
                <Label>E-Mail</Label>
                <Input type="email" value={newLead.contact_email} onChange={e => setNewLead(p => ({ ...p, contact_email: e.target.value }))} />
              </div>
              <div>
                <Label>Anzahl Azubis</Label>
                <Input type="number" value={newLead.azubi_count} onChange={e => setNewLead(p => ({ ...p, azubi_count: e.target.value }))} />
              </div>
              <div>
                <Label>Quelle</Label>
                <Select value={newLead.source} onValueChange={v => setNewLead(p => ({ ...p, source: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="website">Website</SelectItem>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="email">E-Mail</SelectItem>
                    <SelectItem value="referral">Empfehlung</SelectItem>
                    <SelectItem value="event">Event</SelectItem>
                    <SelectItem value="content">Content</SelectItem>
                    <SelectItem value="other">Sonstiges</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notizen</Label>
                <Textarea value={newLead.notes} onChange={e => setNewLead(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <Button onClick={() => addLead.mutate()} disabled={!newLead.company_name || addLead.isPending} className="w-full">
                Lead anlegen
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Leads Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Unternehmen</TableHead>
            <TableHead>Kontakt</TableHead>
            <TableHead>Azubis</TableHead>
            <TableHead>Quelle</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Deal</TableHead>
            <TableHead>Erstellt</TableHead>
            <TableHead className="text-right">Nächster Schritt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads?.map((lead) => (
            <TableRow key={lead.id}>
              <TableCell className="font-medium">{lead.company_name}</TableCell>
              <TableCell className="text-sm">{lead.contact_name || '–'}</TableCell>
              <TableCell>{lead.azubi_count || '–'}</TableCell>
              <TableCell><Badge variant="outline" className="capitalize">{lead.source}</Badge></TableCell>
              <TableCell>
                <Select
                  value={lead.status}
                  onValueChange={(v) => updateStatus.mutate({ id: lead.id, status: v })}
                >
                  <SelectTrigger className="w-[150px] h-8">
                    <Badge variant={statusColors[lead.status] || 'outline'}>
                      {statusLabels[lead.status] || lead.status}
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>{lead.deal_value_eur ? `${lead.deal_value_eur}€` : '–'}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {format(new Date(lead.created_at), 'dd.MM.yy', { locale: de })}
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">
                {lead.next_action || '–'}
              </TableCell>
            </TableRow>
          ))}
          {(!leads || leads.length === 0) && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                Noch keine B2B Leads
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
