import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, FileText, Target, Zap, CheckCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface ContentBrief {
  id: string;
  title: string;
  content_type: string;
  persona: string | null;
  primary_angle: string | null;
  search_intent: string | null;
  funnel_stage: string | null;
  cta_type: string | null;
  target_word_count: number;
  status: string;
  target_publish_date: string | null;
  created_at: string;
}

const CONTENT_TYPES = ['blog', 'landing', 'product', 'faq', 'glossary', 'comparison'];
const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: 'Entwurf', color: 'bg-muted text-muted-foreground', icon: <FileText className="h-3 w-3" /> },
  approved: { label: 'Freigegeben', color: 'bg-blue-500/15 text-blue-600', icon: <CheckCircle className="h-3 w-3" /> },
  in_progress: { label: 'In Arbeit', color: 'bg-amber-500/15 text-amber-600', icon: <Clock className="h-3 w-3" /> },
  published: { label: 'Veröffentlicht', color: 'bg-emerald-500/15 text-emerald-600', icon: <Zap className="h-3 w-3" /> },
};

export default function ContentBriefManager() {
  const qc = useQueryClient();
  const { data: briefs = [], isLoading } = useQuery({
    queryKey: ['seo-content-briefs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seo_content_briefs' as any).select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ContentBrief[];
    },
  });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});

  const addMutation = useMutation({
    mutationFn: async (brief: Record<string, any>) => {
      const { error } = await supabase.from('seo_content_briefs' as any).insert({
        title: brief.title,
        content_type: brief.content_type || 'blog',
        persona: brief.persona || null,
        primary_angle: brief.primary_angle || null,
        search_intent: brief.search_intent || null,
        funnel_stage: brief.funnel_stage || null,
        cta_type: brief.cta_type || null,
        cta_text: brief.cta_text || null,
        target_word_count: parseInt(brief.target_word_count) || 1500,
        secondary_keywords: brief.secondary_keywords ? brief.secondary_keywords.split(',').map((s: string) => s.trim()) : null,
        entities: brief.entities ? brief.entities.split(',').map((s: string) => s.trim()) : null,
        target_publish_date: brief.target_publish_date || null,
        generated_brief_md: brief.generated_brief_md || null,
        status: 'draft',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-content-briefs'] });
      setShowAdd(false);
      setForm({});
      toast.success('Content Brief erstellt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <Card><CardContent className="py-10"><Skeleton className="h-40 w-full" /></CardContent></Card>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(STATUS_MAP).map(([key, { label, color, icon }]) => (
          <Card key={key}><CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold">{briefs.filter(b => b.status === key).length}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">{icon} {label}</div>
          </CardContent></Card>
        ))}
      </div>

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Content Briefs</h3>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 text-xs gap-1"><Plus className="h-3 w-3" /> Brief erstellen</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-sm">Neuer Content Brief</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-xs">Titel *</Label>
                <Input value={form.title || ''} onChange={e => setForm({ ...form, title: e.target.value })} className="h-8 text-xs" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Content-Typ</Label>
                  <Select value={form.content_type || 'blog'} onValueChange={v => setForm({ ...form, content_type: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{CONTENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div><Label className="text-xs">Persona</Label>
                  <Select value={form.persona || ''} onValueChange={v => setForm({ ...form, persona: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Optional" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="azubi">Azubi</SelectItem>
                      <SelectItem value="betrieb">Betrieb</SelectItem>
                      <SelectItem value="institution">Institution</SelectItem>
                    </SelectContent>
                  </Select></div>
              </div>
              <div><Label className="text-xs">Primärer Blickwinkel</Label>
                <Input value={form.primary_angle || ''} onChange={e => setForm({ ...form, primary_angle: e.target.value })} className="h-8 text-xs" placeholder="z.B. Typische Fehler bei der IHK-Prüfung" /></div>
              <div><Label className="text-xs">Search Intent</Label>
                <Input value={form.search_intent || ''} onChange={e => setForm({ ...form, search_intent: e.target.value })} className="h-8 text-xs" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">CTA-Typ</Label>
                  <Input value={form.cta_type || ''} onChange={e => setForm({ ...form, cta_type: e.target.value })} className="h-8 text-xs" placeholder="z.B. Prüfungstraining starten" /></div>
                <div><Label className="text-xs">Wortanzahl</Label>
                  <Input type="number" value={form.target_word_count || '1500'} onChange={e => setForm({ ...form, target_word_count: e.target.value })} className="h-8 text-xs" /></div>
              </div>
              <div><Label className="text-xs">Secondary Keywords (Komma-getrennt)</Label>
                <Input value={form.secondary_keywords || ''} onChange={e => setForm({ ...form, secondary_keywords: e.target.value })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Entities (Komma-getrennt)</Label>
                <Input value={form.entities || ''} onChange={e => setForm({ ...form, entities: e.target.value })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Ziel-Veröffentlichung</Label>
                <Input type="date" value={form.target_publish_date || ''} onChange={e => setForm({ ...form, target_publish_date: e.target.value })} className="h-8 text-xs" /></div>
              <Button size="sm" className="w-full" disabled={!form.title || addMutation.isPending}
                onClick={() => addMutation.mutate(form)}>
                {addMutation.isPending ? 'Erstellen...' : 'Brief erstellen'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {briefs.length === 0 && (
          <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">
            Keine Briefs vorhanden. Erstelle deinen ersten Content Brief.
          </CardContent></Card>
        )}
        {briefs.map(b => {
          const st = STATUS_MAP[b.status] || STATUS_MAP.draft;
          return (
            <Card key={b.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="pt-3 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{b.title}</span>
                      <Badge variant="outline" className={`text-[10px] ${st.color}`}>{st.label}</Badge>
                      <Badge variant="secondary" className="text-[10px]">{b.content_type}</Badge>
                      {b.persona && <Badge variant="outline" className="text-[10px]">{b.persona}</Badge>}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1 flex gap-3">
                      {b.primary_angle && <span>Angle: {b.primary_angle}</span>}
                      <span>{b.target_word_count} Wörter</span>
                      {b.target_publish_date && <span>Ziel: {new Date(b.target_publish_date).toLocaleDateString('de')}</span>}
                    </div>
                  </div>
                  <Target className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
