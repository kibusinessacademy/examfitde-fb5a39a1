import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Search, Clock, User, Tag, Filter } from 'lucide-react';
import { useAdminAuditLog } from '@/hooks/useAdminAudit';
import { KpiCard, CommandKpiStrip } from './shared/CommandKpiStrip';
import { EmptyState } from './shared/EmptyState';

export default function AuditPanel() {
  const { data: events, isLoading } = useAdminAuditLog({ limit: 200 });
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  const actionTypes = useMemo(() => {
    if (!events) return [];
    return [...new Set(events.map(e => e.action))].sort();
  }, [events]);

  const filtered = useMemo(() => {
    if (!events) return [];
    return events.filter(e => {
      if (actionFilter !== 'all' && e.action !== actionFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return e.action.toLowerCase().includes(s) ||
          e.scope?.toLowerCase().includes(s) ||
          e.user_id?.toLowerCase().includes(s) ||
          JSON.stringify(e.payload || {}).toLowerCase().includes(s);
      }
      return true;
    });
  }, [events, search, actionFilter]);

  const kpis = useMemo(() => {
    if (!events) return null;
    const today = events.filter(e => {
      const diff = Date.now() - new Date(e.created_at).getTime();
      return diff < 86400000;
    });
    const week = events.filter(e => {
      const diff = Date.now() - new Date(e.created_at).getTime();
      return diff < 7 * 86400000;
    });
    return {
      total: events.length,
      today: today.length,
      week: week.length,
      actors: new Set(events.filter(e => e.user_id).map(e => e.user_id)).size,
    };
  }, [events]);

  const formatTime = (d: string) => {
    const date = new Date(d);
    return `${date.toLocaleDateString('de-DE')} ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="space-y-4">
      {kpis && (
        <CommandKpiStrip>
          <KpiCard label="Gesamt" value={kpis.total} icon={<FileText className="h-4 w-4 text-primary" />} />
          <KpiCard label="Heute" value={kpis.today} icon={<Clock className="h-4 w-4 text-success" />} tone={kpis.today > 0 ? 'green' : 'neutral'} />
          <KpiCard label="7 Tage" value={kpis.week} icon={<Clock className="h-4 w-4 text-muted-foreground" />} />
          <KpiCard label="Akteure" value={kpis.actors} icon={<User className="h-4 w-4 text-primary" />} />
        </CommandKpiStrip>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Suchen…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 text-sm" />
        </div>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[180px] h-9 text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Alle Aktionen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Aktionen</SelectItem>
            {actionTypes.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10" />)}</div>
      ) : !filtered.length ? (
        <EmptyState
          icon={<FileText className="h-6 w-6 text-muted-foreground" />}
          title="Keine Audit-Einträge"
          description="Administrative Aktionen werden hier protokolliert."
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Zeitpunkt</TableHead>
                <TableHead className="text-xs">Aktion</TableHead>
                <TableHead className="text-xs hidden sm:table-cell">Scope</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Akteur</TableHead>
                <TableHead className="text-xs hidden lg:table-cell">Betroffene</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 100).map(evt => (
                <TableRow key={evt.id}>
                  <TableCell className="py-2 text-[11px] text-muted-foreground whitespace-nowrap">{formatTime(evt.created_at)}</TableCell>
                  <TableCell className="py-2">
                    <Badge variant="outline" className="text-[10px] font-mono">{evt.action}</Badge>
                  </TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground hidden sm:table-cell">{evt.scope || '–'}</TableCell>
                  <TableCell className="py-2 text-xs font-mono text-muted-foreground hidden md:table-cell">{evt.user_id?.slice(0, 8) || '–'}</TableCell>
                  <TableCell className="py-2 text-xs hidden lg:table-cell">
                    {evt.affected_ids?.length ? (
                      <span className="text-muted-foreground">{evt.affected_ids.length} Objekte</span>
                    ) : '–'}
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
