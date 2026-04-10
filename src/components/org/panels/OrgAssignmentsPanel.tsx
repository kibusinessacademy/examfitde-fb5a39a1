import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { OrgContext } from '@/hooks/useOrgConsole';
import { KpiCard, CommandKpiStrip } from '@/components/admin/enterprise/shared/CommandKpiStrip';
import { StatusBadge } from '@/components/admin/enterprise/shared/StatusBadge';
import { EmptyState } from '@/components/admin/enterprise/shared/EmptyState';
import { Armchair, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';

interface Props {
  orgId: string;
  context: OrgContext | null | undefined;
}

export default function OrgAssignmentsPanel({ orgId, context }: Props) {
  const [search, setSearch] = useState('');

  const { data: seats = [] } = useQuery({
    queryKey: ['org-seats-assignments', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_seats')
        .select('id, entity_id, learner_user_id, product_id, seat_status, start_at, end_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  const activeSeats = seats.filter((s: any) => s.seat_status === 'active' || s.seat_status === 'ACTIVE');
  const filtered = seats.filter((s: any) =>
    !search || s.learner_user_id?.toLowerCase().includes(search.toLowerCase()) ||
    s.product_id?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <CommandKpiStrip>
        <KpiCard label="Aktive Seats" value={activeSeats.length} icon={<Armchair className="h-4 w-4 text-success" />} tone="green" />
        <KpiCard label="Seats gesamt" value={seats.length} icon={<Armchair className="h-4 w-4 text-muted-foreground" />} />
      </CommandKpiStrip>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Seat suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </div>
        <Button variant="outline" size="sm" className="text-xs">Bulk Assign</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Armchair className="h-5 w-5" />}
          title="Keine Zuweisungen"
          description="Es gibt noch keine Seat-Zuweisungen in dieser Organisation."
        />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Nutzer</TableHead>
                <TableHead className="text-xs">Produkt</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Start</TableHead>
                <TableHead className="text-xs">Ende</TableHead>
                <TableHead className="text-xs">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 100).map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="text-xs font-mono truncate max-w-[160px]">{s.learner_user_id}</TableCell>
                  <TableCell className="text-xs font-mono truncate max-w-[160px]">{s.product_id}</TableCell>
                  <TableCell><StatusBadge status={s.seat_status?.toLowerCase() || 'unknown'} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.start_at ? new Date(s.start_at).toLocaleDateString('de-DE') : '–'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.end_at ? new Date(s.end_at).toLocaleDateString('de-DE') : '–'}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="text-xs h-7 text-destructive">Entziehen</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
