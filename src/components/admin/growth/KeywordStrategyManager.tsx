import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Search, TrendingUp, Target, Zap, Loader2, Sparkles, Wrench, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface SeoKeyword {
  id: string;
  keyword: string;
  cluster_id: string | null;
  intent_type: string;
  funnel_stage: string;
  persona: string | null;
  search_volume: number | null;
  difficulty: number | null;
  business_value: number;
  conversion_value: number;
  curriculum_fit: number;
  content_gap_score: number;
  opportunity_score: number;
  target_page_type: string | null;
  target_url: string | null;
  secondary_keywords: string[] | null;
  entity_terms: string[] | null;
  status: string;
  notes: string | null;
  created_at: string;
}

const INTENT_TYPES = ['informational', 'transactional', 'navigational', 'commercial_investigation'];
const FUNNEL_STAGES = ['tofu', 'mofu', 'bofu'];
const PAGE_TYPES = ['blog', 'landing', 'product', 'faq', 'glossary', 'comparison'];
const PERSONAS = ['azubi', 'betrieb', 'institution'];

function calcOpportunityScore(kw: Partial<SeoKeyword>): number {
  const sv = Math.min((kw.search_volume || 0) / 1000, 10);
  const cv = kw.conversion_value || 5;
  const cf = kw.curriculum_fit || 5;
  const pf = kw.persona ? 8 : 5;
  const cg = kw.content_gap_score || 0;
  const lc = kw.difficulty ? Math.max(0, 10 - kw.difficulty / 10) : 5;
  return Math.round(((sv * 0.20) + (cv * 0.25) + (cf * 0.20) + (pf * 0.15) + (cg * 0.10) + (lc * 0.10)) * 10) / 10;
}

function useKeywords() {
  return useQuery({
    queryKey: ['seo-keywords'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seo_keywords' as any)
        .select('*')
        .order('opportunity_score', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as SeoKeyword[];
    },
  });
}

/** Auto-heal: create a content brief for a gap keyword */
async function autoCreateBrief(kw: SeoKeyword) {
  const { error } = await supabase.from('seo_content_briefs' as any).insert({
    keyword_id: kw.id,
    target_keyword: kw.keyword,
    page_type: kw.target_page_type || 'blog',
    status: 'draft',
    funnel_stage: kw.funnel_stage,
    persona: kw.persona,
    notes: `Auto-erstellt für Content Gap (Score: ${kw.content_gap_score}). Suchvolumen: ${kw.search_volume || 'k.A.'}`,
  });
  if (error) throw error;
}

/** Auto-heal: set gap status to active and reduce gap score */
async function autoHealGap(kw: SeoKeyword) {
  const { error } = await supabase.from('seo_keywords' as any).update({
    status: 'active',
    content_gap_score: Math.max(0, kw.content_gap_score - 3),
    notes: `${kw.notes || ''}\n[Auto-Heal] Gap geschlossen am ${new Date().toLocaleDateString('de-DE')}`.trim(),
  }).eq('id', kw.id);
  if (error) throw error;
}

export default function KeywordStrategyManager() {
  const qc = useQueryClient();
  const { data: keywords = [], isLoading } = useKeywords();
  const [search, setSearch] = useState('');
  const [filterIntent, setFilterIntent] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [healingIds, setHealingIds] = useState<Set<string>>(new Set());

  const addMutation = useMutation({
    mutationFn: async (kw: Record<string, any>) => {
      const score = calcOpportunityScore(kw as any);
      const { error } = await supabase.from('seo_keywords' as any).insert({
        keyword: kw.keyword,
        intent_type: kw.intent_type || 'informational',
        funnel_stage: kw.funnel_stage || 'tofu',
        persona: kw.persona || null,
        search_volume: kw.search_volume ? parseInt(kw.search_volume) : null,
        difficulty: kw.difficulty ? parseInt(kw.difficulty) : null,
        business_value: parseInt(kw.business_value) || 5,
        conversion_value: parseInt(kw.conversion_value) || 5,
        curriculum_fit: parseInt(kw.curriculum_fit) || 5,
        content_gap_score: parseInt(kw.content_gap_score) || 0,
        target_page_type: kw.target_page_type || null,
        target_url: kw.target_url || null,
        secondary_keywords: kw.secondary_keywords ? kw.secondary_keywords.split(',').map((s: string) => s.trim()) : null,
        entity_terms: kw.entity_terms ? kw.entity_terms.split(',').map((s: string) => s.trim()) : null,
        opportunity_score: score,
        status: 'new',
        notes: kw.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-keywords'] });
      setShowAdd(false);
      setForm({});
      toast.success('Keyword hinzugefügt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleAutoHeal = async (kw: SeoKeyword) => {
    setHealingIds(prev => new Set([...prev, kw.id]));
    try {
      // 1. Create content brief
      await autoCreateBrief(kw);
      // 2. Update gap status
      await autoHealGap(kw);
      qc.invalidateQueries({ queryKey: ['seo-keywords'] });
      qc.invalidateQueries({ queryKey: ['seo-content-briefs'] });
      toast.success(`Gap für "${kw.keyword}" geheilt – Brief erstellt`);
    } catch (e: any) {
      toast.error(`Auto-Heal fehlgeschlagen: ${e.message}`);
    } finally {
      setHealingIds(prev => { const n = new Set(prev); n.delete(kw.id); return n; });
    }
  };

  const handleBulkHeal = async () => {
    const gaps = keywords.filter(k => k.content_gap_score > 5);
    if (gaps.length === 0) { toast.info('Keine Content Gaps > 5 gefunden'); return; }
    toast.info(`Heile ${gaps.length} Content Gaps…`);
    let success = 0;
    for (const kw of gaps) {
      try {
        await autoCreateBrief(kw);
        await autoHealGap(kw);
        success++;
      } catch { /* skip individual failures */ }
    }
    qc.invalidateQueries({ queryKey: ['seo-keywords'] });
    qc.invalidateQueries({ queryKey: ['seo-content-briefs'] });
    toast.success(`${success}/${gaps.length} Gaps geheilt`);
  };

  const filtered = keywords.filter(k => {
    if (search && !k.keyword.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterIntent !== 'all' && k.intent_type !== filterIntent) return false;
    if (filterStatus !== 'all' && k.status !== filterStatus) return false;
    return true;
  });

  const gapKeywords = keywords.filter(k => k.content_gap_score > 5);

  const intentColor: Record<string, string> = {
    informational: 'bg-blue-500/15 text-blue-600',
    transactional: 'bg-emerald-500/15 text-emerald-600',
    navigational: 'bg-purple-500/15 text-purple-600',
    commercial_investigation: 'bg-amber-500/15 text-amber-600',
  };

  const scoreColor = (s: number) => s >= 7 ? 'text-emerald-500' : s >= 4 ? 'text-amber-500' : 'text-red-500';

  if (isLoading) return <Card><CardContent className="py-10"><Skeleton className="h-40 w-full" /></CardContent></Card>;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-primary">{keywords.length}</div>
          <div className="text-xs text-muted-foreground">Keywords</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-emerald-500">{keywords.filter(k => k.status === 'active').length}</div>
          <div className="text-xs text-muted-foreground">Aktiv</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-amber-500">{keywords.filter(k => k.opportunity_score >= 7).length}</div>
          <div className="text-xs text-muted-foreground">High Opportunity</div>
        </CardContent></Card>
        <Card className={gapKeywords.length > 0 ? 'border-amber-500/40' : ''}>
          <CardContent className="pt-4 pb-3 text-center">
            <div className={`text-2xl font-bold ${gapKeywords.length > 0 ? 'text-amber-500' : 'text-blue-500'}`}>
              {gapKeywords.length}
            </div>
            <div className="text-xs text-muted-foreground">Content Gaps</div>
          </CardContent>
        </Card>
      </div>

      {/* Gap Auto-Heal Banner */}
      {gapKeywords.length > 0 && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <Wrench className="h-4 w-4 text-amber-500" />
              <span><strong>{gapKeywords.length}</strong> Content Gaps erkannt – Briefs können automatisch erstellt werden</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1 border-amber-500/30 hover:bg-amber-500/10 text-amber-600"
              onClick={handleBulkHeal}
            >
              <Sparkles className="h-3 w-3" /> Alle heilen
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Toolbar */}
      <Card><CardContent className="pt-4 pb-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Keyword suchen..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
          <Select value={filterIntent} onValueChange={setFilterIntent}>
            <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Intent" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Intents</SelectItem>
              {INTENT_TYPES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              <SelectItem value="new">Neu</SelectItem>
              <SelectItem value="active">Aktiv</SelectItem>
              <SelectItem value="parked">Geparkt</SelectItem>
              <SelectItem value="completed">Erledigt</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={showAdd} onOpenChange={setShowAdd}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-xs gap-1"><Plus className="h-3 w-3" /> Keyword</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="text-sm">Neues Keyword</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label className="text-xs">Keyword *</Label>
                  <Input value={form.keyword || ''} onChange={e => setForm({ ...form, keyword: e.target.value })} className="h-8 text-xs" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Intent</Label>
                    <Select value={form.intent_type || 'informational'} onValueChange={v => setForm({ ...form, intent_type: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{INTENT_TYPES.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div><Label className="text-xs">Funnel</Label>
                    <Select value={form.funnel_stage || 'tofu'} onValueChange={v => setForm({ ...form, funnel_stage: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{FUNNEL_STAGES.map(f => <SelectItem key={f} value={f}>{f.toUpperCase()}</SelectItem>)}</SelectContent>
                    </Select></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label className="text-xs">Persona</Label>
                    <Select value={form.persona || ''} onValueChange={v => setForm({ ...form, persona: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Optional" /></SelectTrigger>
                      <SelectContent>{PERSONAS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div><Label className="text-xs">Seitentyp</Label>
                    <Select value={form.target_page_type || ''} onValueChange={v => setForm({ ...form, target_page_type: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Empfehlung" /></SelectTrigger>
                      <SelectContent>{PAGE_TYPES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select></div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label className="text-xs">Suchvolumen</Label>
                    <Input type="number" value={form.search_volume || ''} onChange={e => setForm({ ...form, search_volume: e.target.value })} className="h-8 text-xs" /></div>
                  <div><Label className="text-xs">Difficulty (0-100)</Label>
                    <Input type="number" value={form.difficulty || ''} onChange={e => setForm({ ...form, difficulty: e.target.value })} className="h-8 text-xs" /></div>
                  <div><Label className="text-xs">Business Value (1-10)</Label>
                    <Input type="number" value={form.business_value || ''} onChange={e => setForm({ ...form, business_value: e.target.value })} className="h-8 text-xs" /></div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label className="text-xs">Conversion (1-10)</Label>
                    <Input type="number" value={form.conversion_value || ''} onChange={e => setForm({ ...form, conversion_value: e.target.value })} className="h-8 text-xs" /></div>
                  <div><Label className="text-xs">Curriculum Fit (1-10)</Label>
                    <Input type="number" value={form.curriculum_fit || ''} onChange={e => setForm({ ...form, curriculum_fit: e.target.value })} className="h-8 text-xs" /></div>
                  <div><Label className="text-xs">Content Gap (0-10)</Label>
                    <Input type="number" value={form.content_gap_score || ''} onChange={e => setForm({ ...form, content_gap_score: e.target.value })} className="h-8 text-xs" /></div>
                </div>
                <div><Label className="text-xs">Secondary Keywords (Komma-getrennt)</Label>
                  <Input value={form.secondary_keywords || ''} onChange={e => setForm({ ...form, secondary_keywords: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Entity Terms (Komma-getrennt)</Label>
                  <Input value={form.entity_terms || ''} onChange={e => setForm({ ...form, entity_terms: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Ziel-URL</Label>
                  <Input value={form.target_url || ''} onChange={e => setForm({ ...form, target_url: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Notizen</Label>
                  <Textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} className="text-xs min-h-[60px]" /></div>
                <div className="p-2 rounded bg-muted/50 text-xs">
                  <span className="text-muted-foreground">Opportunity Score: </span>
                  <span className={`font-bold ${scoreColor(calcOpportunityScore(form as any))}`}>
                    {calcOpportunityScore(form as any).toFixed(1)}
                  </span>
                </div>
                <Button size="sm" className="w-full" disabled={!form.keyword || addMutation.isPending}
                  onClick={() => addMutation.mutate(form)}>
                  {addMutation.isPending ? 'Speichern...' : 'Keyword speichern'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent></Card>

      {/* Keyword List */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">
            Keine Keywords gefunden. Füge dein erstes Keyword hinzu.
          </CardContent></Card>
        )}
        {filtered.map(kw => {
          const isGap = kw.content_gap_score > 5;
          const isHealing = healingIds.has(kw.id);
          return (
            <Card key={kw.id} className={`hover:border-primary/30 transition-colors ${isGap ? 'border-l-2 border-l-amber-500' : ''}`}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{kw.keyword}</span>
                      <Badge variant="outline" className={`text-[10px] ${intentColor[kw.intent_type] || ''}`}>
                        {kw.intent_type}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{kw.funnel_stage?.toUpperCase()}</Badge>
                      {kw.persona && <Badge variant="outline" className="text-[10px]">{kw.persona}</Badge>}
                      {kw.target_page_type && <Badge variant="secondary" className="text-[10px]">→ {kw.target_page_type}</Badge>}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                      {kw.search_volume != null && <span>Vol: {kw.search_volume.toLocaleString()}</span>}
                      {kw.difficulty != null && <span>Diff: {kw.difficulty}</span>}
                      <span>BV: {kw.business_value}</span>
                      <span>CV: {kw.conversion_value}</span>
                      <span>CF: {kw.curriculum_fit}</span>
                      {kw.content_gap_score > 0 && <span className="text-amber-500 font-semibold">Gap: {kw.content_gap_score}</span>}
                    </div>
                    {/* Gap Auto-Heal Actions */}
                    {isGap && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-[10px] h-6 gap-1 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                          disabled={isHealing}
                          onClick={() => handleAutoHeal(kw)}
                        >
                          {isHealing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                          Gap heilen
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-[10px] h-6 gap-1 text-muted-foreground"
                          disabled={isHealing}
                          onClick={async () => {
                            try {
                              await autoCreateBrief(kw);
                              qc.invalidateQueries({ queryKey: ['seo-content-briefs'] });
                              toast.success('Brief erstellt');
                            } catch (e: any) { toast.error(e.message); }
                          }}
                        >
                          <FileText className="h-3 w-3" /> Brief erstellen
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${scoreColor(kw.opportunity_score)}`}>
                      {Number(kw.opportunity_score).toFixed(1)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Score</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
