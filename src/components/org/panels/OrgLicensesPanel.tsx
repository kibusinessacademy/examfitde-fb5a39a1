import { OrgContext } from '@/hooks/useOrgConsole';
import { KpiCard, CommandKpiStrip } from '@/components/admin/enterprise/shared/CommandKpiStrip';
import { StatusBadge, SeatUsageBar } from '@/components/admin/enterprise/shared/StatusBadge';
import { EmptyState } from '@/components/admin/enterprise/shared/EmptyState';
import { CreditCard, Armchair } from 'lucide-react';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';

interface Props {
  orgId: string;
  context: OrgContext | null | undefined;
}

export default function OrgLicensesPanel({ orgId, context }: Props) {
  const seats = context?.seats || [];

  // Group seats by product
  const byProduct = new Map<string, { product_id: string; total: number; active: number }>();
  for (const s of seats) {
    const key = s.product_id || 'unknown';
    if (!byProduct.has(key)) byProduct.set(key, { product_id: key, total: 0, active: 0 });
    const entry = byProduct.get(key)!;
    entry.total++;
    if (s.seat_status === 'active' || s.seat_status === 'ACTIVE') entry.active++;
  }

  const licenses = Array.from(byProduct.values());
  const totalSeats = seats.length;
  const activeSeats = seats.filter((s: any) => s.seat_status === 'active' || s.seat_status === 'ACTIVE').length;

  return (
    <div className="space-y-4">
      <CommandKpiStrip>
        <KpiCard label="Produkte" value={licenses.length} icon={<CreditCard className="h-4 w-4 text-primary" />} />
        <KpiCard label="Seats gesamt" value={totalSeats} icon={<Armchair className="h-4 w-4 text-muted-foreground" />} />
        <KpiCard label="Seats aktiv" value={activeSeats} icon={<Armchair className="h-4 w-4 text-success" />} tone="green" />
        <KpiCard label="Seats frei" value={totalSeats - activeSeats} icon={<Armchair className="h-4 w-4 text-warning" />} tone={totalSeats - activeSeats === 0 ? 'red' : 'neutral'} />
      </CommandKpiStrip>

      {licenses.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-5 w-5" />}
          title="Keine Lizenzen"
          description="Für diese Organisation sind noch keine Lizenzen vorhanden."
        />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Produkt</TableHead>
                <TableHead className="text-xs">Auslastung</TableHead>
                <TableHead className="text-xs">Aktiv</TableHead>
                <TableHead className="text-xs">Gesamt</TableHead>
                <TableHead className="text-xs">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {licenses.map(l => (
                <TableRow key={l.product_id}>
                  <TableCell className="text-xs font-mono truncate max-w-[200px]">{l.product_id}</TableCell>
                  <TableCell><SeatUsageBar used={l.active} total={l.total} /></TableCell>
                  <TableCell className="text-xs">{l.active}</TableCell>
                  <TableCell className="text-xs">{l.total}</TableCell>
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
