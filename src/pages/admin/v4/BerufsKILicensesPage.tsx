import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Building2, Key, Users, Loader2, Trash2, Save, Shield, Copy } from 'lucide-react';

// ─── Types ───
interface Organization {
  id: string;
  name: string;
  domain: string | null;
  billing_email: string;
  vat_id: string | null;
  admin_user_id: string | null;
  created_at: string | null;
}

interface License {
  id: string;
  org_id: string;
  product_id: string | null;
  bundle_id: string | null;
  plan: string;
  seats: number;
  starts_at: string;
  ends_at: string;
  status: string | null;
  watermark_text: string | null;
  created_at: string | null;
}

interface LicenseKey {
  id: string;
  license_id: string;
  key: string;
  status: string | null;
  activated_at: string | null;
  created_at: string | null;
}

// ─── Hooks ───
function useOrganizations() {
  return useQuery({
    queryKey: ['berufski-organizations'],
    queryFn: async () => {
      const { data, error } = await supabase.from('berufski_organizations').select('*').order('name');
      if (error) throw error;
      return (data || []) as Organization[];
    },
  });
}

function useLicenses(orgId?: string) {
  return useQuery({
    queryKey: ['berufski-licenses', orgId],
    queryFn: async () => {
      let q = supabase.from('berufski_licenses').select('*').order('created_at', { ascending: false });
      if (orgId) q = q.eq('org_id', orgId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as License[];
    },
  });
}

function useLicenseKeys(licenseId?: string) {
  return useQuery({
    queryKey: ['berufski-license-keys', licenseId],
    queryFn: async () => {
      if (!licenseId) return [];
      const { data, error } = await supabase.from('berufski_license_keys').select('*').eq('license_id', licenseId).order('created_at');
      if (error) throw error;
      return (data || []) as LicenseKey[];
    },
    enabled: !!licenseId,
  });
}

export default function BerufsKILicensesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Lizenz-Verwaltung</h1>
        <p className="text-muted-foreground">B2B-Organisationen, Lizenzen & Schlüssel verwalten</p>
      </div>

      <Tabs defaultValue="orgs">
        <TabsList>
          <TabsTrigger value="orgs"><Building2 className="h-4 w-4 mr-1" />Organisationen</TabsTrigger>
          <TabsTrigger value="licenses"><Shield className="h-4 w-4 mr-1" />Lizenzen</TabsTrigger>
          <TabsTrigger value="keys"><Key className="h-4 w-4 mr-1" />Schlüssel</TabsTrigger>
        </TabsList>

        <TabsContent value="orgs" className="mt-4"><OrganizationsSection /></TabsContent>
        <TabsContent value="licenses" className="mt-4"><LicensesSection /></TabsContent>
        <TabsContent value="keys" className="mt-4"><KeysSection /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Organizations ───
function OrganizationsSection() {
  const { data: orgs = [], isLoading } = useOrganizations();
  const [showCreate, setShowCreate] = useState(false);
  const qc = useQueryClient();

  const deleteOrg = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('berufski_organizations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Organisation gelöscht'); qc.invalidateQueries({ queryKey: ['berufski-organizations'] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{orgs.length} Organisationen</p>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Organisation anlegen</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Neue Organisation</DialogTitle></DialogHeader>
            <OrgForm onSuccess={() => setShowCreate(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {orgs.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Noch keine Organisationen.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {orgs.map(o => (
            <Card key={o.id}>
              <CardContent className="py-4 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    <span className="font-medium">{o.name}</span>
                    {o.domain && <Badge variant="outline">{o.domain}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {o.billing_email}{o.vat_id && ` · USt-ID: ${o.vat_id}`}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteOrg.mutate(o.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function OrgForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', billing_email: '', domain: '', vat_id: '' });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('berufski_organizations').insert({
        name: form.name, billing_email: form.billing_email,
        domain: form.domain || null, vat_id: form.vat_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Organisation erstellt');
      qc.invalidateQueries({ queryKey: ['berufski-organizations'] });
      onSuccess();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-4">
      <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Mustermann GmbH" /></div>
      <div><Label>Rechnungs-E-Mail *</Label><Input type="email" value={form.billing_email} onChange={e => setForm(f => ({ ...f, billing_email: e.target.value }))} placeholder="billing@example.de" /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Domain</Label><Input value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} placeholder="example.de" /></div>
        <div><Label>USt-ID</Label><Input value={form.vat_id} onChange={e => setForm(f => ({ ...f, vat_id: e.target.value }))} placeholder="DE123456789" /></div>
      </div>
      <Button onClick={() => save.mutate()} disabled={!form.name || !form.billing_email || save.isPending} className="w-full">
        {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Erstellen
      </Button>
    </div>
  );
}

// ─── Licenses ───
function LicensesSection() {
  const { data: licenses = [], isLoading } = useLicenses();
  const { data: orgs = [] } = useOrganizations();
  const [showCreate, setShowCreate] = useState(false);
  const qc = useQueryClient();

  const orgMap = new Map(orgs.map(o => [o.id, o.name]));

  const statusColors: Record<string, 'default' | 'secondary' | 'destructive'> = {
    active: 'default', expired: 'destructive', revoked: 'destructive', pending: 'secondary',
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{licenses.length} Lizenzen</p>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Lizenz erstellen</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Neue Lizenz</DialogTitle></DialogHeader>
            <LicenseForm orgs={orgs} onSuccess={() => setShowCreate(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {licenses.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Keine Lizenzen vorhanden.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {licenses.map(l => (
            <Card key={l.id}>
              <CardContent className="py-4 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    <span className="font-medium">{orgMap.get(l.org_id) || 'Unbekannt'}</span>
                    <Badge variant={statusColors[l.status || 'pending'] || 'secondary'}>{l.status || 'pending'}</Badge>
                    <Badge variant="outline">{l.plan}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <Users className="inline h-3 w-3 mr-1" />{l.seats} Seats · 
                    {' '}{new Date(l.starts_at).toLocaleDateString('de-DE')} – {new Date(l.ends_at).toLocaleDateString('de-DE')}
                    {l.watermark_text && ` · Wasserzeichen: ${l.watermark_text}`}
                  </p>
                </div>
                <Badge variant="outline" className="text-xs font-mono">{l.id.slice(0, 8)}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function LicenseForm({ orgs, onSuccess }: { orgs: Organization[]; onSuccess: () => void }) {
  const qc = useQueryClient();
  const now = new Date();
  const oneYear = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

  const [form, setForm] = useState({
    org_id: '', plan: 'team', seats: 10,
    starts_at: now.toISOString().split('T')[0],
    ends_at: oneYear.toISOString().split('T')[0],
    watermark_text: '',
  });

  const save = useMutation({
    mutationFn: async () => {
      const org = orgs.find(o => o.id === form.org_id);
      const { error } = await supabase.from('berufski_licenses').insert({
        org_id: form.org_id, plan: form.plan, seats: form.seats,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        status: 'active',
        watermark_text: form.watermark_text || `Lizenziert für ${org?.name || ''}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Lizenz erstellt');
      qc.invalidateQueries({ queryKey: ['berufski-licenses'] });
      onSuccess();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-4">
      <div>
        <Label>Organisation *</Label>
        <Select value={form.org_id} onValueChange={v => setForm(f => ({ ...f, org_id: v }))}>
          <SelectTrigger><SelectValue placeholder="Organisation wählen" /></SelectTrigger>
          <SelectContent>
            {orgs.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Plan</Label>
          <Select value={form.plan} onValueChange={v => setForm(f => ({ ...f, plan: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="team">Team (bis 10)</SelectItem>
              <SelectItem value="enterprise">Enterprise (bis 100)</SelectItem>
              <SelectItem value="site">Standortlizenz</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Seats</Label><Input type="number" value={form.seats} onChange={e => setForm(f => ({ ...f, seats: parseInt(e.target.value) || 1 }))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Start</Label><Input type="date" value={form.starts_at} onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} /></div>
        <div><Label>Ende</Label><Input type="date" value={form.ends_at} onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))} /></div>
      </div>
      <div><Label>Wasserzeichen-Text</Label><Input value={form.watermark_text} onChange={e => setForm(f => ({ ...f, watermark_text: e.target.value }))} placeholder="Auto: Lizenziert für [Org]" /></div>
      <Button onClick={() => save.mutate()} disabled={!form.org_id || save.isPending} className="w-full">
        {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Lizenz erstellen
      </Button>
    </div>
  );
}

// ─── License Keys ───
function KeysSection() {
  const { data: licenses = [] } = useLicenses();
  const [selectedLicense, setSelectedLicense] = useState<string>('');
  const { data: keys = [], isLoading } = useLicenseKeys(selectedLicense || undefined);
  const qc = useQueryClient();

  const generateKey = useMutation({
    mutationFn: async (licenseId: string) => {
      const key = `BKI-${crypto.randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
      const { error } = await supabase.from('berufski_license_keys').insert({
        license_id: licenseId, key, status: 'active',
      });
      if (error) throw error;
      return key;
    },
    onSuccess: (key) => {
      toast.success(`Schlüssel generiert: ${key}`);
      qc.invalidateQueries({ queryKey: ['berufski-license-keys'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success('Schlüssel kopiert');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Label>Lizenz auswählen</Label>
          <Select value={selectedLicense} onValueChange={setSelectedLicense}>
            <SelectTrigger><SelectValue placeholder="Lizenz wählen" /></SelectTrigger>
            <SelectContent>
              {licenses.map(l => (
                <SelectItem key={l.id} value={l.id}>
                  {l.plan} · {l.seats} Seats · {l.id.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedLicense && (
          <Button onClick={() => generateKey.mutate(selectedLicense)} disabled={generateKey.isPending} className="mt-6">
            {generateKey.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Key className="mr-2 h-4 w-4" />}
            Key generieren
          </Button>
        )}
      </div>

      {!selectedLicense ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Lizenz auswählen, um Schlüssel zu sehen.</CardContent></Card>
      ) : isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : keys.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Keine Schlüssel für diese Lizenz.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {keys.map(k => (
            <Card key={k.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <code className="text-sm font-mono bg-muted px-2 py-1 rounded">{k.key}</code>
                  <Badge variant={k.status === 'active' ? 'default' : 'secondary'}>{k.status}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  {k.activated_at && <span className="text-xs text-muted-foreground">Aktiviert: {new Date(k.activated_at).toLocaleDateString('de-DE')}</span>}
                  <Button variant="ghost" size="sm" onClick={() => copyKey(k.key)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
