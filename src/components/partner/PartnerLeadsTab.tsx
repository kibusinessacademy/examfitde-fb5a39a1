import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { usePartnerLeads, useCreatePartnerLead } from '@/hooks/usePartnerSystem';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Building2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props { partnerId: string; }

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  new: { label: 'Neu', variant: 'secondary' },
  qualified: { label: 'Qualifiziert', variant: 'default' },
  converted: { label: 'Konvertiert', variant: 'outline' },
  lost: { label: 'Verloren', variant: 'destructive' },
};

export function PartnerLeadsTab({ partnerId }: Props) {
  const { data: leads, isLoading } = usePartnerLeads(partnerId);
  const createLead = useCreatePartnerLead();
  const [showCreate, setShowCreate] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [source, setSource] = useState('');

  const handleCreate = async () => {
    if (!orgName.trim() && !contactName.trim()) {
      toast.error('Organisations- oder Kontaktname erforderlich');
      return;
    }
    try {
      await createLead.mutateAsync({
        partner_id: partnerId,
        org_name: orgName || undefined,
        contact_name: contactName || undefined,
        contact_email: contactEmail || undefined,
        source: source || undefined,
      });
      toast.success('Lead erfolgreich eingereicht!');
      setShowCreate(false);
      setOrgName(''); setContactName(''); setContactEmail(''); setSource('');
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Erstellen');
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Building2 className="h-5 w-5" /> B2B Leads
        </h3>
        <Button onClick={() => setShowCreate(!showCreate)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Lead einreichen
        </Button>
      </div>

      {showCreate && (
        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle className="text-sm">Neuen Lead einreichen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Organisationsname" value={orgName} onChange={e => setOrgName(e.target.value)} />
              <Input placeholder="Kontaktperson" value={contactName} onChange={e => setContactName(e.target.value)} />
              <Input placeholder="E-Mail" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
              <Input placeholder="Quelle (z.B. Messe, LinkedIn)" value={source} onChange={e => setSource(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Abbrechen</Button>
              <Button size="sm" onClick={handleCreate} disabled={createLead.isPending}>Einreichen</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="glass-card">
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Kontakt</TableHead>
                <TableHead>Quelle</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads?.map((lead: any) => {
                const st = statusConfig[lead.lead_status] || { label: lead.lead_status, variant: 'outline' as const };
                return (
                  <TableRow key={lead.id}>
                    <TableCell className="text-sm">{new Date(lead.created_at).toLocaleDateString('de-DE')}</TableCell>
                    <TableCell><Badge variant="outline">{lead.lead_type.toUpperCase()}</Badge></TableCell>
                    <TableCell className="text-sm">{lead.org_name || '—'}</TableCell>
                    <TableCell className="text-sm">{lead.contact_name || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{lead.source || '—'}</TableCell>
                    <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                  </TableRow>
                );
              })}
              {(!leads || leads.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Noch keine Leads eingereicht. Nutze „Lead einreichen" um B2B-Kontakte zu vermitteln.
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
