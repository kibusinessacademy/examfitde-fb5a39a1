import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Key, Plus, XCircle, Copy, Eye, EyeOff, Loader2, Clock, Shield } from 'lucide-react';
import {
  useAdminApiKeys, useApiKeyEvents, useCreateApiKey, useRevokeApiKey,
  API_KEY_SCOPES, type AdminApiKey,
} from '@/hooks/useAdminApiKeys';
import { useAdminOrganizations } from '@/hooks/useAdminLicenses';
import { StatusBadge } from './shared/StatusBadge';
import { KpiCard, CommandKpiStrip } from './shared/CommandKpiStrip';
import { EmptyState } from './shared/EmptyState';
import { toast } from 'sonner';

export default function ApiKeysPanel() {
  const { data: keys, isLoading } = useAdminApiKeys();
  const { data: orgs } = useAdminOrganizations();
  const createMut = useCreateApiKey();
  const revokeMut = useRevokeApiKey();

  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AdminApiKey | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [newKeyRaw, setNewKeyRaw] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  // Create form state
  const [name, setName] = useState('');
  const [orgId, setOrgId] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState('');

  const { data: events } = useApiKeyEvents(selectedKey);

  const kpis = useMemo(() => {
    if (!keys) return null;
    return {
      total: keys.length,
      active: keys.filter(k => k.status === 'active').length,
      revoked: keys.filter(k => k.status === 'revoked').length,
      expiringSoon: keys.filter(k => {
        if (!k.expires_at || k.status !== 'active') return false;
        const days = (new Date(k.expires_at).getTime() - Date.now()) / 86400000;
        return days > 0 && days <= 30;
      }).length,
    };
  }, [keys]);

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('de-DE') : '–';
  const formatRelative = (d: string | null) => {
    if (!d) return 'Nie';
    const diff = Date.now() - new Date(d).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Heute';
    if (days < 30) return `vor ${days}d`;
    return formatDate(d);
  };

  const handleCreate = async () => {
    if (!name || !orgId || scopes.length === 0) {
      toast.error('Name, Organisation und mindestens ein Scope erforderlich');
      return;
    }
    const raw = await createMut.mutateAsync({
      name, org_id: orgId, scopes,
      expires_at: expiresAt || undefined,
    });
    setNewKeyRaw(raw);
    setCreateOpen(false);
    setName(''); setOrgId(''); setScopes([]); setExpiresAt('');
  };

  const toggleScope = (scope: string) => {
    setScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);
  };

  const copyKey = () => {
    if (newKeyRaw) {
      navigator.clipboard.writeText(newKeyRaw);
      toast.success('Key kopiert');
    }
  };

  return (
    <div className="space-y-4">
      {kpis && (
        <CommandKpiStrip>
          <KpiCard label="Gesamt" value={kpis.total} icon={<Key className="h-4 w-4 text-primary" />} />
          <KpiCard label="Aktiv" value={kpis.active} icon={<Key className="h-4 w-4 text-success" />} tone="green" />
          <KpiCard label="Widerrufen" value={kpis.revoked} icon={<XCircle className="h-4 w-4 text-destructive" />} />
          <KpiCard label="Läuft ab (30d)" value={kpis.expiringSoon} icon={<Clock className="h-4 w-4 text-warning" />} tone={kpis.expiringSoon > 0 ? 'yellow' : 'neutral'} />
        </CommandKpiStrip>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> API Key erstellen
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : !keys?.length ? (
        <EmptyState
          icon={<Key className="h-6 w-6 text-muted-foreground" />}
          title="Noch keine API Keys"
          description="Erstelle einen API Key für externe Integrationen."
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Prefix</TableHead>
                <TableHead className="text-xs hidden sm:table-cell">Scopes</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Status</TableHead>
                <TableHead className="text-xs hidden md:table-cell">Zuletzt</TableHead>
                <TableHead className="text-xs hidden lg:table-cell">Ablauf</TableHead>
                <TableHead className="text-xs">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map(key => (
                <TableRow key={key.id} className="cursor-pointer" onClick={() => setSelectedKey(key.id)}>
                  <TableCell className="py-2 text-sm font-medium">{key.name}</TableCell>
                  <TableCell className="py-2 font-mono text-xs text-muted-foreground">{key.key_prefix}…</TableCell>
                  <TableCell className="py-2 hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.slice(0, 2).map(s => (
                        <Badge key={s} variant="outline" className="text-[10px] px-1 py-0">{s}</Badge>
                      ))}
                      {key.scopes.length > 2 && <Badge variant="outline" className="text-[10px] px-1 py-0">+{key.scopes.length - 2}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="py-2 hidden md:table-cell"><StatusBadge status={key.status} /></TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground hidden md:table-cell">{formatRelative(key.last_used_at)}</TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground hidden lg:table-cell">{key.expires_at ? formatDate(key.expires_at) : '∞'}</TableCell>
                  <TableCell className="py-2">
                    {key.status === 'active' && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                        onClick={(e) => { e.stopPropagation(); setRevokeTarget(key); }}>
                        Widerrufen
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* New Key Display */}
      <Dialog open={!!newKeyRaw} onOpenChange={(open) => !open && setNewKeyRaw(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key erstellt</DialogTitle>
            <DialogDescription>Kopiere den Key jetzt — er wird nur einmal angezeigt.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 bg-muted rounded-lg p-3">
            <code className="text-xs font-mono flex-1 break-all">
              {showKey ? newKeyRaw : '•'.repeat(40)}
            </code>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setShowKey(!showKey)}>
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={copyKey}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => { setNewKeyRaw(null); setShowKey(false); }}>Fertig</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Neuen API Key erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="z.B. SCIM Integration" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Organisation</label>
              <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={orgId} onChange={e => setOrgId(e.target.value)}>
                <option value="">Wählen…</option>
                {orgs?.map(o => <option key={o.org_id} value={o.org_id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Scopes</label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {API_KEY_SCOPES.map(scope => (
                  <label key={scope} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox checked={scopes.includes(scope)} onCheckedChange={() => toggleScope(scope)} />
                    {scope}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Ablaufdatum (optional)</label>
              <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Abbrechen</Button>
            <Button onClick={handleCreate} disabled={createMut.isPending}>
              {createMut.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirm */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>API Key widerrufen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Key <strong>{revokeTarget?.name}</strong> ({revokeTarget?.key_prefix}…) wird sofort deaktiviert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (revokeTarget) revokeMut.mutate(revokeTarget.id, { onSuccess: () => setRevokeTarget(null) }); }} disabled={revokeMut.isPending}>
              {revokeMut.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Widerrufen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Key Detail Drawer */}
      <Sheet open={!!selectedKey} onOpenChange={(open) => !open && setSelectedKey(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Key Details</SheetTitle>
          </SheetHeader>
          {selectedKey && keys && (
            <div className="mt-4 space-y-4">
              {(() => {
                const key = keys.find(k => k.id === selectedKey);
                if (!key) return <p className="text-sm text-muted-foreground">Nicht gefunden</p>;
                return (
                  <>
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Übersicht</CardTitle></CardHeader>
                      <CardContent className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span className="font-medium">{key.name}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Prefix</span><span className="font-mono">{key.key_prefix}…</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={key.status} /></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Erstellt</span><span>{formatDate(key.created_at)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Zuletzt genutzt</span><span>{formatRelative(key.last_used_at)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Ablauf</span><span>{key.expires_at ? formatDate(key.expires_at) : '∞'}</span></div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Scopes ({key.scopes.length})</CardTitle></CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-1.5">
                          {key.scopes.map(s => (
                            <Badge key={s} variant="outline" className="text-[10px]">
                              <Shield className="h-2.5 w-2.5 mr-0.5" />{s}
                            </Badge>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Ereignisse</CardTitle></CardHeader>
                      <CardContent>
                        {!events?.length ? (
                          <p className="text-xs text-muted-foreground">Keine Ereignisse</p>
                        ) : (
                          <div className="space-y-2">
                            {events.map(evt => (
                              <div key={evt.id} className="flex items-center justify-between border-b last:border-0 pb-1.5">
                                <Badge variant="outline" className="text-[10px]">{evt.event_type}</Badge>
                                <span className="text-[10px] text-muted-foreground">{formatDate(evt.created_at)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                );
              })()}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
