import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Search, UserCheck, UserX, Ticket, Loader2 } from 'lucide-react';
import { useAdminUsers, useAdminUserDetail } from '@/hooks/useAdminUsers';
import { StatusBadge, RoleBadge, SourceBadge } from './shared/StatusBadge';
import { KpiCard, CommandKpiStrip } from './shared/CommandKpiStrip';
import { EmptyState } from './shared/EmptyState';

export default function UsersPanel() {
  const [search, setSearch] = useState('');
  const { data: users, isLoading } = useAdminUsers({ search: search || undefined });
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const { data: userDetail, isLoading: detailLoading } = useAdminUserDetail(selectedUserId);

  const kpis = useMemo(() => {
    if (!users) return null;
    const list = users.users;
    return {
      total: users.total || list.length,
      active: list.filter(u => u.status === 'active').length,
      withSeat: list.filter(u => u.seat_count > 0).length,
      noSeat: list.filter(u => u.seat_count === 0).length,
      noLogin: list.filter(u => !u.last_sign_in_at).length,
    };
  }, [users]);

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('de-DE') : '–';
  const formatRelative = (d: string | null) => {
    if (!d) return 'Nie';
    const diff = Date.now() - new Date(d).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Heute';
    if (days === 1) return 'Gestern';
    if (days < 30) return `vor ${days}d`;
    return formatDate(d);
  };

  return (
    <div className="space-y-4">
      {kpis && (
        <CommandKpiStrip>
          <KpiCard label="Gesamt" value={kpis.total} icon={<Users className="h-4 w-4 text-primary" />} />
          <KpiCard label="Aktiv" value={kpis.active} icon={<UserCheck className="h-4 w-4 text-success" />} tone="green" />
          <KpiCard label="Mit Seat" value={kpis.withSeat} icon={<Ticket className="h-4 w-4 text-primary" />} />
          <KpiCard label="Ohne Seat" value={kpis.noSeat} icon={<UserX className="h-4 w-4 text-warning" />} tone={kpis.noSeat > 0 ? 'yellow' : 'neutral'} />
          <KpiCard label="Nie eingeloggt" value={kpis.noLogin} icon={<UserX className="h-4 w-4 text-muted-foreground" />} tone={kpis.noLogin > 0 ? 'yellow' : 'neutral'} />
        </CommandKpiStrip>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Name oder E-Mail suchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : !users?.users?.length ? (
        <EmptyState
          icon={<Users className="h-6 w-6 text-muted-foreground" />}
          title="Noch keine Nutzer gefunden"
          description="Passe deine Filter an oder importiere Nutzer über Bulk Import."
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs hidden sm:table-cell">E-Mail</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Organisation</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Rolle</TableHead>
                <TableHead className="text-xs hidden lg:table-cell">Seats</TableHead>
                <TableHead className="text-xs hidden lg:table-cell">Status</TableHead>
                <TableHead className="text-xs hidden xl:table-cell">Letzter Login</TableHead>
                <TableHead className="text-xs hidden xl:table-cell">Quelle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.users.map(user => (
                <TableRow
                  key={user.user_id}
                  className="cursor-pointer"
                  onClick={() => setSelectedUserId(user.user_id)}
                >
                  <TableCell className="py-2">
                    <div className="text-sm font-medium truncate max-w-[200px]">{user.display_name || user.email?.split('@')[0]}</div>
                    <div className="text-[10px] text-muted-foreground sm:hidden truncate">{user.email}</div>
                  </TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground hidden sm:table-cell truncate max-w-[200px]">{user.email}</TableCell>
                  <TableCell className="py-2 text-xs hidden md:table-cell">{user.org_name || '–'}</TableCell>
                  <TableCell className="py-2 hidden md:table-cell">{user.role ? <RoleBadge role={user.role} /> : '–'}</TableCell>
                  <TableCell className="py-2 text-xs hidden lg:table-cell">{user.seat_count || '–'}</TableCell>
                  <TableCell className="py-2 hidden lg:table-cell"><StatusBadge status={user.status} /></TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground hidden xl:table-cell">{formatRelative(user.last_sign_in_at)}</TableCell>
                  <TableCell className="py-2 hidden xl:table-cell"><SourceBadge source={user.source_type} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* User Detail Drawer */}
      <Sheet open={!!selectedUserId} onOpenChange={(open) => !open && setSelectedUserId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Nutzerdetails</SheetTitle>
          </SheetHeader>
          {detailLoading ? (
            <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : userDetail ? (
            <div className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Übersicht</CardTitle></CardHeader>
                <CardContent className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">E-Mail</span><span className="font-mono">{userDetail.email}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span>{userDetail.display_name || '–'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Erstellt</span><span>{formatDate(userDetail.created_at)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Letzter Login</span><span>{formatRelative(userDetail.last_sign_in_at)}</span></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Mitgliedschaften ({userDetail.memberships.length})</CardTitle></CardHeader>
                <CardContent>
                  {userDetail.memberships.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Keine Organisationszugehörigkeit</p>
                  ) : (
                    <div className="space-y-2">
                      {userDetail.memberships.map((m, i) => (
                        <div key={i} className="flex items-center justify-between border-b last:border-0 pb-1.5">
                          <span className="text-xs font-medium">{m.org_name}</span>
                          <RoleBadge role={m.role} />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Aktive Seats ({userDetail.seats.length})</CardTitle></CardHeader>
                <CardContent>
                  {userDetail.seats.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Keine Seat-Zuweisungen</p>
                  ) : (
                    <div className="space-y-2">
                      {userDetail.seats.map((s, i) => (
                        <div key={i} className="flex items-center justify-between border-b last:border-0 pb-1.5">
                          <span className="text-xs">{s.product_title || s.license_id.slice(0, 8)}</span>
                          <span className="text-[10px] text-muted-foreground">{formatDate(s.claimed_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Direkte Entitlements ({userDetail.entitlements.length})</CardTitle></CardHeader>
                <CardContent>
                  {userDetail.entitlements.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Keine direkten Berechtigungen</p>
                  ) : (
                    <div className="space-y-2">
                      {userDetail.entitlements.map((e, i) => (
                        <div key={i} className="flex items-center justify-between border-b last:border-0 pb-1.5">
                          <span className="text-xs">{e.product_title || e.product_id.slice(0, 8)}</span>
                          <span className="text-[10px] text-muted-foreground">{formatDate(e.valid_from)} – {e.valid_until ? formatDate(e.valid_until) : '∞'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">Nutzer nicht gefunden</p>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
