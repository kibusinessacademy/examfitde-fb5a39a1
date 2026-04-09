import { useState } from 'react';
import { OrgContext } from '@/hooks/useOrgConsole';
import { KpiCard, CommandKpiStrip } from '@/components/admin/enterprise/shared/CommandKpiStrip';
import { RoleBadge, StatusBadge } from '@/components/admin/enterprise/shared/StatusBadge';
import { EmptyState } from '@/components/admin/enterprise/shared/EmptyState';
import { Users, Search, UserCheck, UserX } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';

interface Props {
  orgId: string;
  context: OrgContext | null | undefined;
}

export default function OrgUsersPanel({ orgId, context }: Props) {
  const [search, setSearch] = useState('');
  const members = context?.members || [];
  const seats = context?.seats || [];

  const filtered = members.filter((m: any) =>
    !search || m.user_id?.toLowerCase().includes(search.toLowerCase())
  );

  const seatsByUser = new Map<string, number>();
  for (const s of seats) {
    if (s.seat_status === 'active' || s.seat_status === 'ACTIVE') {
      seatsByUser.set(s.learner_user_id, (seatsByUser.get(s.learner_user_id) || 0) + 1);
    }
  }

  const withSeat = members.filter((m: any) => seatsByUser.has(m.user_id)).length;

  return (
    <div className="space-y-4">
      <CommandKpiStrip>
        <KpiCard label="Nutzer gesamt" value={members.length} icon={<Users className="h-4 w-4 text-primary" />} />
        <KpiCard label="Mit Seat" value={withSeat} icon={<UserCheck className="h-4 w-4 text-success" />} tone="green" />
        <KpiCard label="Ohne Seat" value={members.length - withSeat} icon={<UserX className="h-4 w-4 text-warning" />} tone={members.length - withSeat > 0 ? 'yellow' : 'neutral'} />
      </CommandKpiStrip>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Nutzer suchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="Keine Nutzer"
          description="In dieser Organisation sind noch keine Mitglieder vorhanden."
        />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">User ID</TableHead>
                <TableHead className="text-xs">Rolle</TableHead>
                <TableHead className="text-xs">Seats</TableHead>
                <TableHead className="text-xs">Beigetreten</TableHead>
                <TableHead className="text-xs">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs font-mono truncate max-w-[180px]">{m.user_id}</TableCell>
                  <TableCell><RoleBadge role={m.role} /></TableCell>
                  <TableCell className="text-xs">{seatsByUser.get(m.user_id) || 0}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {m.created_at ? new Date(m.created_at).toLocaleDateString('de-DE') : '–'}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="text-xs h-7">Details</Button>
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
