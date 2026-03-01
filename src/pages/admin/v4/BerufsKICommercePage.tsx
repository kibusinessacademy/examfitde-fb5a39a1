import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Plus, Loader2, Tag, Users, Mail, Rocket, ShoppingCart,
  CheckCircle2, XCircle, Eye, Download, TicketPercent
} from 'lucide-react';

// ─── Hooks ───
function useCoupons() {
  return useQuery({
    queryKey: ['berufski-coupons'],
    queryFn: async () => {
      const { data, error } = await supabase.from('berufski_coupons').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

function useAffiliates() {
  return useQuery({
    queryKey: ['berufski-affiliates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('berufski_affiliates').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

function usePurchases() {
  return useQuery({
    queryKey: ['berufski-purchases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('berufski_purchases')
        .select('*, berufski_produkte(titel, tier)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });
}

function useEmailOutbox() {
  return useQuery({
    queryKey: ['berufski-email-outbox'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('berufski_email_outbox')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });
}

function usePublishableProducts() {
  return useQuery({
    queryKey: ['berufski-publishable'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('berufski_produkte')
        .select('id, titel, tier, status, published_at, stripe_price_id, beruf_id, berufski_berufe(name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// ─── Main Page ───
export default function BerufsKICommercePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">BerufsKI Commerce</h1>
        <p className="text-muted-foreground">Publish Gate, Coupons, Affiliates, Verkäufe & E-Mails</p>
      </div>

      <Tabs defaultValue="publish">
        <TabsList>
          <TabsTrigger value="publish"><Rocket className="h-4 w-4 mr-1" />Publish</TabsTrigger>
          <TabsTrigger value="coupons"><TicketPercent className="h-4 w-4 mr-1" />Coupons</TabsTrigger>
          <TabsTrigger value="affiliates"><Users className="h-4 w-4 mr-1" />Affiliates</TabsTrigger>
          <TabsTrigger value="purchases"><ShoppingCart className="h-4 w-4 mr-1" />Verkäufe</TabsTrigger>
          <TabsTrigger value="emails"><Mail className="h-4 w-4 mr-1" />E-Mails</TabsTrigger>
        </TabsList>

        <TabsContent value="publish" className="mt-4"><PublishSection /></TabsContent>
        <TabsContent value="coupons" className="mt-4"><CouponsSection /></TabsContent>
        <TabsContent value="affiliates" className="mt-4"><AffiliatesSection /></TabsContent>
        <TabsContent value="purchases" className="mt-4"><PurchasesSection /></TabsContent>
        <TabsContent value="emails" className="mt-4"><EmailsSection /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Publish Gate ───
function PublishSection() {
  const qc = useQueryClient();
  const { data: products = [], isLoading } = usePublishableProducts();

  const publish = useMutation({
    mutationFn: async (productId: string) => {
      const { data, error } = await supabase.functions.invoke('berufski-publish-gate', {
        body: { productId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Publish failed');
      return data;
    },
    onSuccess: (data) => {
      toast.success('Produkt publiziert!', { description: `Stripe Price: ${data.stripePriceId}` });
      qc.invalidateQueries({ queryKey: ['berufski-publishable'] });
    },
    onError: (e) => toast.error(`Publish-Fehler: ${(e as Error).message}`),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      {products.map((p: any) => (
        <Card key={p.id}>
          <CardContent className="py-4 flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.titel}</span>
                <Badge variant="outline">{p.tier}€</Badge>
                <Badge variant={p.status === 'published' ? 'default' : 'secondary'}>
                  {p.status === 'published' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                  {p.status || 'draft'}
                </Badge>
                {p.berufski_berufe && <span className="text-sm text-muted-foreground">{(p.berufski_berufe as any).name}</span>}
              </div>
              {p.stripe_price_id && <p className="text-xs text-muted-foreground">Stripe: {p.stripe_price_id}</p>}
              {p.published_at && <p className="text-xs text-muted-foreground">Publiziert: {new Date(p.published_at).toLocaleDateString('de-DE')}</p>}
            </div>
            <Button
              size="sm"
              disabled={p.status === 'published' || publish.isPending}
              onClick={() => publish.mutate(p.id)}
            >
              {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Rocket className="h-4 w-4 mr-1" />}
              {p.status === 'published' ? 'Live' : 'Publizieren'}
            </Button>
          </CardContent>
        </Card>
      ))}
      {products.length === 0 && <p className="text-muted-foreground text-center py-8">Keine Produkte vorhanden.</p>}
    </div>
  );
}

// ─── Coupons ───
function CouponsSection() {
  const qc = useQueryClient();
  const { data: coupons = [], isLoading } = useCoupons();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', type: 'percent' as string, value: '', max_redemptions: '' });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('berufski_coupons').insert({
        code: form.code.toUpperCase(),
        type: form.type,
        value: Number(form.value),
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
        active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Coupon erstellt');
      qc.invalidateQueries({ queryKey: ['berufski-coupons'] });
      setShowCreate(false);
      setForm({ code: '', type: 'percent', value: '', max_redemptions: '' });
    },
    onError: (e) => toast.error(`Fehler: ${(e as Error).message}`),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('berufski_coupons').update({ active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['berufski-coupons'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Coupons ({coupons.length})</h2>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Coupon erstellen</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Neuer Coupon</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Code</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="START10" /></div>
              <div>
                <Label>Typ</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Prozent (%)</SelectItem>
                    <SelectItem value="fixed">Fix (€)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Wert ({form.type === 'percent' ? '%' : '€'})</Label><Input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} /></div>
              <div><Label>Max. Einlösungen (leer = unbegrenzt)</Label><Input type="number" value={form.max_redemptions} onChange={e => setForm(f => ({ ...f, max_redemptions: e.target.value }))} /></div>
              <Button onClick={() => create.mutate()} disabled={!form.code || !form.value || create.isPending} className="w-full">
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}Erstellen
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : (
        <div className="space-y-2">
          {coupons.map((c: any) => (
            <Card key={c.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant={c.active ? 'default' : 'secondary'}>{c.code}</Badge>
                  <span className="text-sm">{c.type === 'percent' ? `${c.value}%` : `${c.value}€`} Rabatt</span>
                  <span className="text-xs text-muted-foreground">{c.redeemed_count}{c.max_redemptions ? `/${c.max_redemptions}` : ''} eingelöst</span>
                </div>
                <Switch checked={c.active} onCheckedChange={v => toggle.mutate({ id: c.id, active: v })} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Affiliates ───
function AffiliatesSection() {
  const qc = useQueryClient();
  const { data: affiliates = [], isLoading } = useAffiliates();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', payout_percent: '30' });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('berufski_affiliates').insert({
        code: form.code.toUpperCase(),
        name: form.name,
        payout_percent: Number(form.payout_percent),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Affiliate erstellt');
      qc.invalidateQueries({ queryKey: ['berufski-affiliates'] });
      setShowCreate(false);
    },
    onError: (e) => toast.error(`Fehler: ${(e as Error).message}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Affiliates ({affiliates.length})</h2>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Affiliate erstellen</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Neuer Affiliate</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Code</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="VERWALTUNG10" /></div>
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Partner Name" /></div>
              <div><Label>Payout (%)</Label><Input type="number" value={form.payout_percent} onChange={e => setForm(f => ({ ...f, payout_percent: e.target.value }))} /></div>
              <Button onClick={() => create.mutate()} disabled={!form.code || !form.name || create.isPending} className="w-full">Erstellen</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : (
        <div className="space-y-2">
          {affiliates.map((a: any) => (
            <Card key={a.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant={a.status === 'active' ? 'default' : 'secondary'}>{a.code}</Badge>
                  <span className="text-sm font-medium">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{a.payout_percent}% Payout</span>
                </div>
                <Badge variant="outline">{a.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Purchases ───
function PurchasesSection() {
  const { data: purchases = [], isLoading } = usePurchases();

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Verkäufe ({purchases.length})</h2>
      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : (
        <div className="space-y-2">
          {purchases.map((p: any) => (
            <Card key={p.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.user_email || p.user_id?.slice(0, 8)}</span>
                    <Badge variant="outline">{((p.amount_cents || 0) / 100).toFixed(2)}€</Badge>
                    {p.coupon_code && <Badge variant="secondary"><Tag className="h-3 w-3 mr-1" />{p.coupon_code}</Badge>}
                    {p.affiliate_code && <Badge variant="outline"><Users className="h-3 w-3 mr-1" />{p.affiliate_code}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {p.berufski_produkte?.titel} · {new Date(p.created_at).toLocaleDateString('de-DE')}
                    {p.download_count ? ` · ${p.download_count}x heruntergeladen` : ''}
                  </p>
                </div>
                <Badge variant={p.status === 'paid' ? 'default' : 'secondary'}>{p.status || 'paid'}</Badge>
              </CardContent>
            </Card>
          ))}
          {purchases.length === 0 && <p className="text-muted-foreground text-center py-8">Noch keine Verkäufe.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Emails ───
function EmailsSection() {
  const qc = useQueryClient();
  const { data: emails = [], isLoading } = useEmailOutbox();

  const flush = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('berufski-email-flush');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.sent} E-Mails versendet`);
      qc.invalidateQueries({ queryKey: ['berufski-email-outbox'] });
    },
    onError: (e) => toast.error(`Fehler: ${(e as Error).message}`),
  });

  const queuedCount = emails.filter((e: any) => e.status === 'queued').length;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">E-Mail Outbox ({emails.length})</h2>
        <Button size="sm" onClick={() => flush.mutate()} disabled={flush.isPending || queuedCount === 0}>
          {flush.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mail className="h-4 w-4 mr-1" />}
          {queuedCount} Queued senden
        </Button>
      </div>

      {isLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : (
        <div className="space-y-2">
          {emails.map((e: any) => (
            <Card key={e.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{e.to_email}</span>
                    <span className="text-xs text-muted-foreground truncate max-w-64">{e.subject}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString('de-DE')}
                    {e.sent_at && ` · Gesendet: ${new Date(e.sent_at).toLocaleString('de-DE')}`}
                  </p>
                </div>
                <Badge variant={e.status === 'sent' ? 'default' : e.status === 'failed' ? 'destructive' : 'secondary'}>
                  {e.status === 'sent' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                  {e.status === 'failed' && <XCircle className="h-3 w-3 mr-1" />}
                  {e.status}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
