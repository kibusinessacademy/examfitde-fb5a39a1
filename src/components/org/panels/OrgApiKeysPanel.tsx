import { useState } from 'react';
import { useAdminApiKeys } from '@/hooks/useAdminApiKeys';
import { KpiCard, CommandKpiStrip } from '@/components/admin/enterprise/shared/CommandKpiStrip';
import { StatusBadge } from '@/components/admin/enterprise/shared/StatusBadge';
import { EmptyState } from '@/components/admin/enterprise/shared/EmptyState';
import { Key, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface Props {
  orgId: string;
}

export default function OrgApiKeysPanel({ orgId }: Props) {
  // For now we show an org-scoped view placeholder.
  // The full API key management uses the same backend but scoped to org_id.
  const { data: allKeys } = useAdminApiKeys();
  const orgKeys = (allKeys || []).filter((k: any) => k.org_id === orgId);

  const activeKeys = orgKeys.filter((k: any) => k.status === 'active');
  const expiringKeys = orgKeys.filter((k: any) => {
    if (!k.expires_at) return false;
    const d = new Date(k.expires_at);
    return d.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
  });

  return (
    <div className="space-y-4">
      <CommandKpiStrip>
        <KpiCard label="Aktive Keys" value={activeKeys.length} icon={<Key className="h-4 w-4 text-success" />} tone="green" />
        <KpiCard label="Bald ablaufend" value={expiringKeys.length} icon={<AlertTriangle className="h-4 w-4 text-warning" />} tone={expiringKeys.length > 0 ? 'yellow' : 'neutral'} />
      </CommandKpiStrip>

      <div className="flex justify-end">
        <Button size="sm" className="text-xs gap-1.5">
          <Plus className="h-3 w-3" /> API Key erstellen
        </Button>
      </div>

      {orgKeys.length === 0 ? (
        <EmptyState
          icon={<Key className="h-5 w-5" />}
          title="Keine API Keys"
          description="Erstellen Sie einen API Key für Ihre Integrationen."
          action={
            <Button size="sm" className="text-xs gap-1.5">
              <Plus className="h-3 w-3" /> Ersten Key erstellen
            </Button>
          }
        />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Prefix</TableHead>
                <TableHead className="text-xs">Scopes</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Ablauf</TableHead>
                <TableHead className="text-xs">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgKeys.map((k: any) => (
                <TableRow key={k.id}>
                  <TableCell className="text-xs font-medium">{k.name}</TableCell>
                  <TableCell className="text-xs font-mono">{k.key_prefix}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(k.scopes || []).slice(0, 3).map((s: string) => (
                        <Badge key={s} variant="outline" className="text-[9px] h-4 px-1">{s}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge status={k.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {k.expires_at ? new Date(k.expires_at).toLocaleDateString('de-DE') : '–'}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="text-xs h-7 text-destructive">Widerrufen</Button>
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
