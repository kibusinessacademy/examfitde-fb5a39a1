import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { OrgContext } from '@/hooks/useOrgConsole';
import { KpiCard, CommandKpiStrip } from '@/components/admin/enterprise/shared/CommandKpiStrip';
import { RoleBadge } from '@/components/admin/enterprise/shared/StatusBadge';
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

  // Fetch members separately (not in context anymore)
  const { data: members = [] } = useQuery({
    queryKey: ['org-members-list', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_memberships')
        .select('id, user_id, role, status, created_at')
        .eq('org_id', orgId)
        .eq('status', 'active');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  const filtered = members.filter((m: any) =>
    !search || m.user_id?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <CommandKpiStrip>
        <KpiCard label="Nutzer gesamt" value={members.length} icon={<Users className="h-4 w-4 text-primary" />} />
      </CommandKpiStrip>

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
                <TableHead className="text-xs">Beigetreten</TableHead>
                <TableHead className="text-xs">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs font-mono truncate max-w-[180px]">{m.user_id}</TableCell>
                  <TableCell><RoleBadge role={m.role} /></TableCell>
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
