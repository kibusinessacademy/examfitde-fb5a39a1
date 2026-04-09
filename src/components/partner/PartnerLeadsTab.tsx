import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { usePartnerLeads } from '@/hooks/usePartnerSystem';
import { Skeleton } from '@/components/ui/skeleton';

interface Props { partnerId: string; }

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  new: { label: 'Neu', variant: 'secondary' },
  qualified: { label: 'Qualifiziert', variant: 'default' },
  converted: { label: 'Konvertiert', variant: 'outline' },
  lost: { label: 'Verloren', variant: 'destructive' },
};

export function PartnerLeadsTab({ partnerId }: Props) {
  const { data: leads, isLoading } = usePartnerLeads(partnerId);

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card className="glass-card">
      <CardContent className="pt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead>Organisation</TableHead>
              <TableHead>Kontakt</TableHead>
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
                  <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                </TableRow>
              );
            })}
            {(!leads || leads.length === 0) && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">Noch keine Leads</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
