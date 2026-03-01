import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Package, Loader2, Trash2, Save, Euro, Tag } from 'lucide-react';

interface Bundle {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  bundle_type: string;
  price_cents: number;
  original_price_cents: number | null;
  included_product_ids: string[] | null;
  bonus_content: unknown;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  is_active: boolean | null;
  sort_order: number | null;
  created_at: string | null;
}

interface Produkt {
  id: string;
  titel: string;
  tier: string;
  beruf_id: string;
}

function useBundles() {
  return useQuery({
    queryKey: ['berufski-bundles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('berufski_bundles').select('*').order('sort_order');
      if (error) throw error;
      return (data || []) as Bundle[];
    },
  });
}

function useProdukte() {
  return useQuery({
    queryKey: ['berufski-alle-produkte'],
    queryFn: async () => {
      const { data, error } = await supabase.from('berufski_produkte').select('id, titel, tier, beruf_id').order('titel');
      if (error) throw error;
      return (data || []) as Produkt[];
    },
  });
}

export default function BerufsKIBundlesPage() {
  const { data: bundles = [], isLoading } = useBundles();
  const [showCreate, setShowCreate] = useState(false);
  const qc = useQueryClient();

  const deleteBundle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('berufski_bundles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Bundle gelöscht'); qc.invalidateQueries({ queryKey: ['berufski-bundles'] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('berufski_bundles').update({ is_active: active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['berufski-bundles'] }); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bundle Builder</h1>
          <p className="text-muted-foreground">Produkt-Bundles erstellen und verwalten</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Neues Bundle</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Bundle erstellen</DialogTitle></DialogHeader>
            <BundleForm onSuccess={() => setShowCreate(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="py-4"><p className="text-2xl font-bold">{bundles.length}</p><p className="text-sm text-muted-foreground">Bundles gesamt</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-2xl font-bold">{bundles.filter(b => b.is_active).length}</p><p className="text-sm text-muted-foreground">Aktiv</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-2xl font-bold">{bundles.filter(b => b.stripe_price_id).length}</p><p className="text-sm text-muted-foreground">Mit Stripe</p></CardContent></Card>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : bundles.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Noch keine Bundles erstellt.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {bundles.map(b => (
            <Card key={b.id}>
              <CardContent className="py-4 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    <span className="font-medium">{b.title}</span>
                    <Badge variant={b.is_active ? 'default' : 'secondary'}>{b.is_active ? 'Aktiv' : 'Inaktiv'}</Badge>
                    <Badge variant="outline">{b.bundle_type === 'single_pdf' ? 'PDF' : 'ZIP'}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {(b.price_cents / 100).toFixed(2)}€
                    {b.original_price_cents && <span className="line-through ml-2">{(b.original_price_cents / 100).toFixed(2)}€</span>}
                    {' · '}{(b.included_product_ids || []).length} Produkte
                    {b.description && ` · ${b.description.slice(0, 60)}…`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={b.is_active ?? false} onCheckedChange={v => toggleActive.mutate({ id: b.id, active: v })} />
                  <Button variant="ghost" size="sm" onClick={() => deleteBundle.mutate(b.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
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

function BundleForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const { data: produkte = [] } = useProdukte();
  const [form, setForm] = useState({
    title: '', slug: '', description: '', bundle_type: 'single_pdf',
    price_cents: 4900, original_price_cents: 5700,
    selected_product_ids: [] as string[],
    is_active: true,
  });

  const save = useMutation({
    mutationFn: async () => {
      const slug = form.slug || form.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const { error } = await supabase.from('berufski_bundles').insert({
        title: form.title, slug, description: form.description || null,
        bundle_type: form.bundle_type, price_cents: form.price_cents,
        original_price_cents: form.original_price_cents || null,
        included_product_ids: form.selected_product_ids,
        is_active: form.is_active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Bundle erstellt');
      qc.invalidateQueries({ queryKey: ['berufski-bundles'] });
      onSuccess();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggleProduct = (id: string) => {
    setForm(f => ({
      ...f,
      selected_product_ids: f.selected_product_ids.includes(id)
        ? f.selected_product_ids.filter(x => x !== id)
        : [...f.selected_product_ids, id],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Titel *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Starter Pack" /></div>
        <div><Label>Slug</Label><Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="auto" /></div>
      </div>
      <div><Label>Beschreibung</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Typ</Label>
          <Select value={form.bundle_type} onValueChange={v => setForm(f => ({ ...f, bundle_type: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single_pdf">Single PDF</SelectItem>
              <SelectItem value="zip">ZIP-Archiv</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Preis (Cent)</Label>
          <Input type="number" value={form.price_cents} onChange={e => setForm(f => ({ ...f, price_cents: parseInt(e.target.value) || 0 }))} />
          <p className="text-xs text-muted-foreground mt-1">{(form.price_cents / 100).toFixed(2)}€</p>
        </div>
        <div>
          <Label>Streichpreis (Cent)</Label>
          <Input type="number" value={form.original_price_cents} onChange={e => setForm(f => ({ ...f, original_price_cents: parseInt(e.target.value) || 0 }))} />
          <p className="text-xs text-muted-foreground mt-1">{(form.original_price_cents / 100).toFixed(2)}€</p>
        </div>
      </div>

      {/* Product Selector */}
      <div>
        <Label>Enthaltene Produkte ({form.selected_product_ids.length})</Label>
        <div className="border rounded-lg p-3 max-h-48 overflow-y-auto space-y-1 mt-1">
          {produkte.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Produkte vorhanden</p>
          ) : produkte.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1 rounded">
              <input type="checkbox" checked={form.selected_product_ids.includes(p.id)} onChange={() => toggleProduct(p.id)} />
              <span>{p.titel}</span>
              <Badge variant="outline" className="text-xs ml-auto">{p.tier}€</Badge>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
        <Label>Sofort aktiv</Label>
      </div>

      <Button onClick={() => save.mutate()} disabled={!form.title || save.isPending} className="w-full">
        {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Bundle erstellen
      </Button>
    </div>
  );
}
