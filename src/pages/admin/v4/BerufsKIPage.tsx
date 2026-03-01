import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Zap, FileText, Link2, Eye, Package, Loader2, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';

// ─── Types ───
interface BerufskiBeruf {
  id: string;
  slug: string;
  name: string;
  branche: string | null;
  typische_aufgaben: string[] | null;
  dokumenttypen: string[] | null;
  pain_points: string[] | null;
  haftungsrisiken: string[] | null;
  digitalisierungsgrad: string | null;
  seo_keywords: string[] | null;
  conversion_story: string | null;
  examfit_curriculum_id: string | null;
  is_published: boolean | null;
  created_at: string | null;
}

interface BerufskiProdukt {
  id: string;
  beruf_id: string;
  tier: string;
  titel: string;
  status: string | null;
  content_json: unknown;
  generation_model: string | null;
  created_at: string | null;
}

// ─── Hooks ───
function useBerufsKIBerufe() {
  return useQuery({
    queryKey: ['berufski-berufe'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('berufski_berufe')
        .select('*')
        .order('name');
      if (error) throw error;
      return (data || []) as BerufskiBeruf[];
    },
  });
}

function useBerufsKIProdukte(berufId?: string) {
  return useQuery({
    queryKey: ['berufski-produkte', berufId],
    queryFn: async () => {
      let q = supabase.from('berufski_produkte').select('*').order('tier');
      if (berufId) q = q.eq('beruf_id', berufId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as BerufskiProdukt[];
    },
    enabled: !!berufId || berufId === undefined,
  });
}

function useCurricula() {
  return useQuery({
    queryKey: ['curricula-for-berufski'],
    queryFn: async () => {
      const { data } = await supabase
        .from('curricula')
        .select('id, title')
        .order('title')
        .limit(500);
      return data || [];
    },
  });
}

// ─── Main Page ───
export default function BerufsKIPage() {
  const [selectedBeruf, setSelectedBeruf] = useState<BerufskiBeruf | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data: berufe = [], isLoading } = useBerufsKIBerufe();
  const { data: produkte = [] } = useBerufsKIProdukte(selectedBeruf?.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">BerufsKI.de</h1>
          <p className="text-muted-foreground">KI-Praxisleitfäden für Berufe verwalten</p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Beruf anlegen</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Neuen Beruf anlegen</DialogTitle>
            </DialogHeader>
            <CreateBerufForm onSuccess={() => setShowCreateDialog(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Berufe" value={berufe.length} icon={<Package className="h-4 w-4" />} />
        <StatCard label="Publiziert" value={berufe.filter(b => b.is_published).length} icon={<Eye className="h-4 w-4" />} />
        <StatCard label="Mit SSOT" value={berufe.filter(b => b.examfit_curriculum_id).length} icon={<Link2 className="h-4 w-4" />} />
        <StatCard label="Produkte" value={produkte.length} icon={<FileText className="h-4 w-4" />} />
      </div>

      <Tabs defaultValue="berufe">
        <TabsList>
          <TabsTrigger value="berufe">Berufe</TabsTrigger>
          <TabsTrigger value="detail" disabled={!selectedBeruf}>
            {selectedBeruf ? selectedBeruf.name : 'Detail'}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="berufe" className="space-y-3 mt-4">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : berufe.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Noch keine Berufe angelegt.</CardContent></Card>
          ) : (
            berufe.map(b => (
              <Card key={b.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedBeruf(b)}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{b.name}</span>
                      {b.is_published && <Badge variant="default" className="text-xs">Live</Badge>}
                      {b.examfit_curriculum_id && <Badge variant="outline" className="text-xs"><Link2 className="h-3 w-3 mr-1" />SSOT</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{b.branche || 'Keine Branche'} · {(b.typische_aufgaben || []).length} Aufgaben · {(b.pain_points || []).length} Pain Points</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{b.slug}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="detail" className="mt-4">
          {selectedBeruf && <BerufDetail beruf={selectedBeruf} produkte={produkte} onUpdate={() => setSelectedBeruf(null)} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Stat Card ───
function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-4 flex items-center justify-between">
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}

// ─── Create Form ───
function CreateBerufForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const { data: curricula = [] } = useCurricula();
  const [form, setForm] = useState({
    name: '', slug: '', branche: '', digitalisierungsgrad: 'mittel',
    typische_aufgaben: '', dokumenttypen: '', pain_points: '', haftungsrisiken: '',
    seo_keywords: '', examfit_curriculum_id: '',
  });

  const create = useMutation({
    mutationFn: async () => {
      const toArr = (s: string) => s.split(',').map(v => v.trim()).filter(Boolean);
      const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss');
      const { error } = await supabase.from('berufski_berufe').insert({
        name: form.name,
        slug,
        branche: form.branche || null,
        digitalisierungsgrad: form.digitalisierungsgrad,
        typische_aufgaben: toArr(form.typische_aufgaben),
        dokumenttypen: toArr(form.dokumenttypen),
        pain_points: toArr(form.pain_points),
        haftungsrisiken: toArr(form.haftungsrisiken),
        seo_keywords: toArr(form.seo_keywords),
        examfit_curriculum_id: form.examfit_curriculum_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Beruf angelegt');
      qc.invalidateQueries({ queryKey: ['berufski-berufe'] });
      onSuccess();
    },
    onError: (e) => toast.error(`Fehler: ${(e as Error).message}`),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Kaufmann/-frau im E-Commerce" /></div>
        <div><Label>Slug</Label><Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="auto-generiert" /></div>
        <div><Label>Branche</Label><Input value={form.branche} onChange={e => setForm(f => ({ ...f, branche: e.target.value }))} placeholder="Handel / Online-Handel" /></div>
        <div>
          <Label>Digitalisierungsgrad</Label>
          <Select value={form.digitalisierungsgrad} onValueChange={v => setForm(f => ({ ...f, digitalisierungsgrad: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="niedrig">Niedrig</SelectItem>
              <SelectItem value="mittel">Mittel</SelectItem>
              <SelectItem value="hoch">Hoch</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>ExamFit Curriculum (SSOT-Verknüpfung)</Label>
        <Select value={form.examfit_curriculum_id} onValueChange={v => setForm(f => ({ ...f, examfit_curriculum_id: v }))}>
          <SelectTrigger><SelectValue placeholder="Optional – für SSOT-Anreicherung" /></SelectTrigger>
          <SelectContent>
            {curricula.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div><Label>Typische Aufgaben (kommagetrennt)</Label><Textarea value={form.typische_aufgaben} onChange={e => setForm(f => ({ ...f, typische_aufgaben: e.target.value }))} placeholder="Onlineshop-Management, Produktdatenpflege, ..." /></div>
      <div><Label>Dokumenttypen (kommagetrennt)</Label><Textarea value={form.dokumenttypen} onChange={e => setForm(f => ({ ...f, dokumenttypen: e.target.value }))} placeholder="Bestellbestätigungen, Rechnungen, ..." /></div>
      <div><Label>Pain Points (kommagetrennt)</Label><Textarea value={form.pain_points} onChange={e => setForm(f => ({ ...f, pain_points: e.target.value }))} placeholder="Zeitaufwändige Produktbeschreibungen, ..." /></div>
      <div><Label>Haftungsrisiken (kommagetrennt)</Label><Textarea value={form.haftungsrisiken} onChange={e => setForm(f => ({ ...f, haftungsrisiken: e.target.value }))} placeholder="DSGVO-Verletzungen, ..." /></div>
      <div><Label>SEO Keywords (kommagetrennt)</Label><Input value={form.seo_keywords} onChange={e => setForm(f => ({ ...f, seo_keywords: e.target.value }))} placeholder="KI E-Commerce, ChatGPT Handel, ..." /></div>
      <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending} className="w-full">
        {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
        Beruf anlegen
      </Button>
    </div>
  );
}

// ─── Beruf Detail with Generator ───
function BerufDetail({ beruf, produkte, onUpdate }: { beruf: BerufskiBeruf; produkte: BerufskiProdukt[]; onUpdate: () => void }) {
  const qc = useQueryClient();
  const [genTier, setGenTier] = useState<string>('9');

  const generate = useMutation({
    mutationFn: async (tier: string) => {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/berufski-generate-product`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ berufskiId: beruf.id, tier }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || 'Generierung fehlgeschlagen');
      }
      return resp.json();
    },
    onSuccess: (data) => {
      toast.success(`Produkt generiert: Tier ${genTier}€`, {
        description: `SSOT: ${data.ssotEnriched?.learningFieldCount || 0} Lernfelder, ${data.ssotEnriched?.blueprintSampleCount || 0} Blueprints`,
      });
      qc.invalidateQueries({ queryKey: ['berufski-produkte'] });
    },
    onError: (e) => toast.error(`Fehler: ${(e as Error).message}`),
  });

  const tierLabels: Record<string, string> = { '9': 'Prompt Guide (9€)', '19': 'Praxisleitfaden (19€)', '29': 'Komplettsystem (29€)' };
  const existingTiers = new Set(produkte.map(p => p.tier));

  return (
    <div className="space-y-6">
      {/* DNA Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                {beruf.name}
                {beruf.examfit_curriculum_id && <Badge variant="outline"><Link2 className="h-3 w-3 mr-1" />SSOT verknüpft</Badge>}
              </CardTitle>
              <CardDescription>{beruf.branche} · Digitalisierung: {beruf.digitalisierungsgrad}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <DNASection title="Typische Aufgaben" items={beruf.typische_aufgaben} />
            <DNASection title="Dokumenttypen" items={beruf.dokumenttypen} />
            <DNASection title="Pain Points" items={beruf.pain_points} />
            <DNASection title="Haftungsrisiken" items={beruf.haftungsrisiken} />
          </div>
        </CardContent>
      </Card>

      {/* Generator */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" />Produkt generieren</CardTitle>
          <CardDescription>
            KI-gestützte Generierung mit SSOT-Anreicherung aus Lernfeldern, Kompetenzen und Blueprint-Mustern
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Select value={genTier} onValueChange={setGenTier}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['9', '19', '29'].map(t => (
                  <SelectItem key={t} value={t}>
                    {tierLabels[t]} {existingTiers.has(t) && '(existiert)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => generate.mutate(genTier)} disabled={generate.isPending}>
              {generate.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generiert (~30s)...</>
              ) : (
                <><Zap className="mr-2 h-4 w-4" />Generieren</>
              )}
            </Button>
          </div>
          {existingTiers.has(genTier) && (
            <p className="text-sm text-destructive mt-2 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />Existierendes Produkt wird überschrieben
            </p>
          )}
        </CardContent>
      </Card>

      {/* Products */}
      <Card>
        <CardHeader>
          <CardTitle>Produkte ({produkte.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {produkte.length === 0 ? (
            <p className="text-muted-foreground text-sm">Noch keine Produkte generiert.</p>
          ) : (
            <div className="space-y-3">
              {produkte.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.titel}</span>
                      <Badge variant={p.status === 'generated' ? 'default' : p.status === 'published' ? 'default' : 'secondary'}>
                        {p.status === 'generated' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {p.status || 'draft'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tier {p.tier}€ · {p.generation_model || '–'} · {p.content_json ? 'Content ✓' : 'Kein Content'}
                    </p>
                  </div>
                  <Badge variant="outline">{p.tier}€</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DNASection({ title, items }: { title: string; items: string[] | null }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-sm font-medium mb-1">{title}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((item, i) => <Badge key={i} variant="secondary" className="text-xs">{item}</Badge>)}
      </div>
    </div>
  );
}
