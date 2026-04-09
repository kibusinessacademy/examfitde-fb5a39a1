import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Ticket, UserMinus, Loader2 } from 'lucide-react';
import { useAdminSeatAssignments, useAdminRevokeSeat, type AdminSeatAssignment } from '@/hooks/useAdminLicenses';
import { StatusBadge } from './shared/StatusBadge';
import { KpiCard, CommandKpiStrip } from './shared/CommandKpiStrip';
import { EmptyState } from './shared/EmptyState';

export default function AssignmentsPanel() {
  const { data: seats, isLoading } = useAdminSeatAssignments();
  const revokeMut = useAdminRevokeSeat();
  const [revokeTarget, setRevokeTarget] = useState<AdminSeatAssignment | null>(null);

  const kpis = useMemo(() => {
    if (!seats) return null;
    const active = seats.filter(s => s.status === 'active');
    const revoked = seats.filter(s => s.status === 'revoked');
    const recentlyAssigned = active.filter(s => {
      const diff = Date.now() - new Date(s.claimed_at).getTime();
      return diff < 7 * 86400000;
    });
    const recentlyRevoked = revoked.filter(s => {
      if (!s.released_at) return false;
      const diff = Date.now() - new Date(s.released_at).getTime();
      return diff < 7 * 86400000;
    });
    return {
      active: active.length,
      total: seats.length,
      recentAssigned: recentlyAssigned.length,
      recentRevoked: recentlyRevoked.length,
    };
  }, [seats]);

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('de-DE') : '–';

  const handleRevoke = () => {
    if (!revokeTarget) return;
    revokeMut.mutate(
      { licenseId: revokeTarget.license_id, userId: revokeTarget.user_id },
      { onSuccess: () => setRevokeTarget(null) }
    );
  };

  return (
    <div className="space-y-4">
      {kpis && (
        <CommandKpiStrip>
          <KpiCard label="Aktive Zuweisungen" value={kpis.active} icon={<Ticket className="h-4 w-4 text-primary" />} tone="green" />
          <KpiCard label="Zuletzt vergeben (7d)" value={kpis.recentAssigned} icon={<Ticket className="h-4 w-4 text-success" />} />
          <KpiCard label="Entzogen (7d)" value={kpis.recentRevoked} icon={<UserMinus className="h-4 w-4 text-warning" />} tone={kpis.recentRevoked > 0 ? 'yellow' : 'neutral'} />
        </CommandKpiStrip>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : !seats?.length ? (
        <EmptyState
          icon={<Ticket className="h-6 w-6 text-muted-foreground" />}
          title="Noch keine Seat-Zuweisungen"
          description="Weise einer aktiven Lizenz Nutzer zu."
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Nutzer</TableHead>
                <TableHead className="text-xs hidden sm:table-cell">Produkt</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Organisation</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Status</TableHead>
                <TableHead className="text-xs hidden lg:table-cell">Vergeben</TableHead>
                <TableHead className="text-xs">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {seats.map(seat => (
                <TableRow key={seat.seat_id}>
                  <TableCell className="py-2">
                    <div className="text-sm font-medium truncate max-w-[180px]">{seat.display_name || seat.email?.split('@')[0] || seat.user_id.slice(0, 8)}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{seat.email}</div>
                  </TableCell>
                  <TableCell className="py-2 text-xs hidden sm:table-cell">{seat.product_title || '–'}</TableCell>
                  <TableCell className="py-2 text-xs hidden md:table-cell">{seat.org_name || '–'}</TableCell>
                  <TableCell className="py-2 hidden md:table-cell"><StatusBadge status={seat.status} /></TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground hidden lg:table-cell">{formatDate(seat.claimed_at)}</TableCell>
                  <TableCell className="py-2">
                    {seat.status === 'active' && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setRevokeTarget(seat)}>
                        <UserMinus className="h-3 w-3 mr-1" /> Entziehen
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Seat entziehen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Zugriff von <strong>{revokeTarget?.display_name || revokeTarget?.email}</strong> auf{' '}
              <strong>{revokeTarget?.product_title}</strong> wird sofort entzogen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} disabled={revokeMut.isPending}>
              {revokeMut.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Seat entziehen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
