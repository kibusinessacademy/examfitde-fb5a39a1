import { useState } from 'react';
import { useOrgAuditEvents } from '@/hooks/useOrgConsole';
import { KpiCard, CommandKpiStrip } from '@/components/admin/enterprise/shared/CommandKpiStrip';
import { EmptyState } from '@/components/admin/enterprise/shared/EmptyState';
import { ScrollText, Search, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

interface Props {
  orgId: string;
}

export default function OrgAuditPanel({ orgId }: Props) {
  const [search, setSearch] = useState('');
  const { data: events, isLoading } = useOrgAuditEvents(orgId);

  const filtered = (events || []).filter((e: any) =>
    !search ||
    e.event_type?.toLowerCase().includes(search.toLowerCase()) ||
    e.description?.toLowerCase().includes(search.toLowerCase())
  );

  const last7d = (events || []).filter((e: any) => {
    const d = new Date(e.created_at);
    return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
  });

  return (
    <div className="space-y-4">
      <CommandKpiStrip>
        <KpiCard label="Events (7 Tage)" value={last7d.length} icon={<ScrollText className="h-4 w-4 text-primary" />} />
        <KpiCard label="Events gesamt" value={(events || []).length} icon={<ScrollText className="h-4 w-4 text-muted-foreground" />} />
      </CommandKpiStrip>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Events durchsuchen..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-5 w-5" />}
          title={isLoading ? "Lade..." : "Keine Audit Events"}
          description="Es sind noch keine auditierbaren Aktionen für diese Organisation vorhanden."
        />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Zeit</TableHead>
                <TableHead className="text-xs">Event</TableHead>
                <TableHead className="text-xs">Entity</TableHead>
                <TableHead className="text-xs">Beschreibung</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 100).map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">{e.event_type}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.entity_type || '–'}</TableCell>
                  <TableCell className="text-xs max-w-[250px] truncate">{e.description || '–'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
