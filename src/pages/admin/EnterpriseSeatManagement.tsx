import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import {
  Building2, Users, UserPlus, Key, Shield,
  CheckCircle, XCircle, Clock, Copy
} from 'lucide-react';
import { toast } from 'sonner';

// ---- Single Account Creator ----
function CreateAccountDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', username: '', personnel_number: '', email: '' });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('enterprise-accounts', {
        body: {
          action: 'create_single',
          ...form,
          email: form.email || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success('Account erstellt');
      setOpen(false);
      setForm({ first_name: '', last_name: '', username: '', personnel_number: '', email: '' });
      onCreated();
      if (data?.credentials) {
        const creds = data.credentials;
        toast.info(`Username: ${creds.username} | Passwort: ${creds.initial_password}`, { duration: 15000 });
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Fehler'),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><UserPlus className="h-4 w-4 mr-2" /> Account erstellen</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Managed Account erstellen</DialogTitle>
          <DialogDescription>Für Azubis ohne eigene E-Mail – Login mit Benutzername + Passwort</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vorname *</Label>
              <Input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
            </div>
            <div>
              <Label>Nachname *</Label>
              <Input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Benutzername *</Label>
            <Input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="z.B. mmueller" />
          </div>
          <div>
            <Label>Personalnummer (optional)</Label>
            <Input value={form.personnel_number} onChange={e => setForm(f => ({ ...f, personnel_number: e.target.value }))} />
          </div>
          <div>
            <Label>E-Mail (optional)</Label>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.first_name || !form.last_name || !form.username}>
            {createMutation.isPending ? 'Erstelle…' : 'Account erstellen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Batch Creator ----
function BatchCreateDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ first_name: string; last_name: string; username: string }[]>([
    { first_name: '', last_name: '', username: '' },
  ]);

  const addRow = () => setRows(r => [...r, { first_name: '', last_name: '', username: '' }]);
  const updateRow = (idx: number, field: string, value: string) => {
    setRows(r => r.map((row, i) => i === idx ? { ...row, [field]: value } : row));
  };
  const removeRow = (idx: number) => setRows(r => r.filter((_, i) => i !== idx));

  const batchMutation = useMutation({
    mutationFn: async () => {
      const validRows = rows.filter(r => r.first_name && r.last_name && r.username);
      if (validRows.length === 0) throw new Error('Keine gültigen Zeilen');
      const { data, error } = await supabase.functions.invoke('enterprise-accounts', {
        body: { action: 'create_batch', accounts: validRows },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data?.created || 0} Accounts erstellt`);
      setOpen(false);
      setRows([{ first_name: '', last_name: '', username: '' }]);
      onCreated();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Fehler'),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Users className="h-4 w-4 mr-2" /> Batch erstellen</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mehrere Accounts erstellen</DialogTitle>
          <DialogDescription>Zeilen ausfüllen – Passwörter werden automatisch generiert</DialogDescription>
        </DialogHeader>
        <div className="max-h-[400px] overflow-y-auto space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
              <Input placeholder="Vorname" value={row.first_name} onChange={e => updateRow(i, 'first_name', e.target.value)} />
              <Input placeholder="Nachname" value={row.last_name} onChange={e => updateRow(i, 'last_name', e.target.value)} />
              <Input placeholder="Username" value={row.username} onChange={e => updateRow(i, 'username', e.target.value)} />
              <Button variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={rows.length <= 1}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={addRow}>+ Zeile hinzufügen</Button>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button onClick={() => batchMutation.mutate()} disabled={batchMutation.isPending}>
            {batchMutation.isPending ? 'Erstelle…' : `${rows.filter(r => r.first_name && r.username).length} Accounts erstellen`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Seat Overview ----
function SeatOverview() {
  const queryClient = useQueryClient();

  const { data: seats, isLoading } = useQuery({
    queryKey: ['enterprise-seats'],
    queryFn: async () => {
      // Use columns that actually exist in the schema
      const { data, error } = await supabase
        .from('license_seats')
        .select('id, package_id, assigned_user_id, assigned_at, invite_code, invite_email, invite_expires_at, licensee_first_name, licensee_last_name, licensee_personnel_number, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ['enterprise-profiles', seats],
    queryFn: async () => {
      const userIds = [...new Set((seats || []).map(s => s.assigned_user_id).filter(Boolean))] as string[];
      if (userIds.length === 0) return [];
      const { data } = await supabase
        .from('profiles')
        .select('id, user_id, full_name, login_username, personnel_number, managed_account')
        .in('user_id', userIds);
      return data || [];
    },
    enabled: !!seats && seats.length > 0,
  });

  const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Kopiert');
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  // Derive status from data: assigned = claimed, has invite_code but no user = available
  const claimed = seats?.filter(s => !!s.assigned_user_id).length || 0;
  const available = seats?.filter(s => !s.assigned_user_id && s.invite_code).length || 0;
  const total = seats?.length || 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card">
          <CardContent className="pt-6 flex items-center gap-3">
            <Users className="h-5 w-5 text-primary" />
            <div>
              <div className="text-2xl font-bold">{total}</div>
              <div className="text-sm text-muted-foreground">Seats gesamt</div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card border-primary/20 bg-primary/5">
          <CardContent className="pt-6 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-primary" />
            <div>
              <div className="text-2xl font-bold">{claimed}</div>
              <div className="text-sm text-muted-foreground">Zugewiesen</div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card border-accent/20 bg-accent/5">
          <CardContent className="pt-6 flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-2xl font-bold">{available}</div>
              <div className="text-sm text-muted-foreground">Verfügbar</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Seat-Übersicht</CardTitle>
            <div className="flex gap-2">
              <CreateAccountDialog onCreated={() => queryClient.invalidateQueries({ queryKey: ['enterprise-seats'] })} />
              <BatchCreateDialog onCreated={() => queryClient.invalidateQueries({ queryKey: ['enterprise-seats'] })} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Seat</TableHead>
                <TableHead>Benutzer</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Personalnr.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invite-Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {seats?.map(seat => {
                const profile = seat.assigned_user_id ? profileMap.get(seat.assigned_user_id) : null;
                const seatStatus = seat.assigned_user_id ? 'claimed' : (seat.invite_code ? 'available' : 'pending');
                const displayName = profile?.full_name
                  || [seat.licensee_first_name, seat.licensee_last_name].filter(Boolean).join(' ')
                  || null;
                return (
                  <TableRow key={seat.id}>
                    <TableCell className="font-mono text-xs">{seat.id.slice(0, 8)}…</TableCell>
                    <TableCell>
                      {displayName || <span className="text-muted-foreground text-xs">Nicht zugewiesen</span>}
                      {profile?.managed_account && <Badge variant="outline" className="ml-1 text-[10px]">Managed</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{profile?.login_username || '–'}</TableCell>
                    <TableCell className="text-xs">{profile?.personnel_number || seat.licensee_personnel_number || '–'}</TableCell>
                    <TableCell>
                      <Badge variant={seatStatus === 'claimed' ? 'default' : 'secondary'}>
                        {seatStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {seat.invite_code && !seat.assigned_user_id ? (
                        <div className="flex items-center gap-1">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{seat.invite_code}</code>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(seat.invite_code!)}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : '–'}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(!seats || seats.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">Keine Seats vorhanden</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Claim Code Info ----
function ClaimCodeSection() {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Key className="h-5 w-5" /> Claim-Code System
        </CardTitle>
        <CardDescription>
          Azubis ohne eigene E-Mail können sich mit Benutzername + Passwort registrieren und einen Claim-Code eingeben, um ihren Seat zu aktivieren.
          Codes sind einmalig verwendbar und laufen nach 30 Tagen ab.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="p-4 rounded-lg border border-border bg-muted/30">
            <Shield className="h-5 w-5 text-primary mb-2" />
            <h4 className="font-medium text-sm">1× verwendbar</h4>
            <p className="text-xs text-muted-foreground mt-1">Jeder Code kann nur einmal eingelöst werden</p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-muted/30">
            <Clock className="h-5 w-5 text-muted-foreground mb-2" />
            <h4 className="font-medium text-sm">Ablaufdatum</h4>
            <p className="text-xs text-muted-foreground mt-1">Codes verfallen nach 30 Tagen automatisch</p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-muted/30">
            <Shield className="h-5 w-5 text-primary mb-2" />
            <h4 className="font-medium text-sm">Immutable Binding</h4>
            <p className="text-xs text-muted-foreground mt-1">Nach Claim kann der Seat nicht umgeschrieben werden</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Main ----
export default function EnterpriseSeatManagement() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold flex items-center gap-3">
          <Building2 className="h-7 w-7 text-primary" />
          Enterprise Seat-Verwaltung
        </h1>
        <p className="text-muted-foreground">Managed Accounts · Seat-Zuweisung · Claim-Codes · Login-Daten Export</p>
      </div>

      <Tabs defaultValue="seats" className="space-y-4">
        <TabsList>
          <TabsTrigger value="seats" className="gap-1.5"><Users className="h-4 w-4" /> Seats & Accounts</TabsTrigger>
          <TabsTrigger value="claim" className="gap-1.5"><Key className="h-4 w-4" /> Claim-System</TabsTrigger>
        </TabsList>
        <TabsContent value="seats"><SeatOverview /></TabsContent>
        <TabsContent value="claim"><ClaimCodeSection /></TabsContent>
      </Tabs>
    </div>
  );
}
