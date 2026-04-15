import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Plus, Pencil, Settings, Search, Globe, Code, AlertTriangle, CheckCircle, Sparkles, Wand2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface SEOSetting {
  id: string;
  page_type: string;
  page_id: string | null;
  meta_title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  og_image: string | null;
  keywords: string[] | null;
  robots_directives: string | null;
  structured_data: any;
  created_at: string;
  updated_at: string;
}

function useSEOSettings() {
  return useQuery({
    queryKey: ['seo-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seo_settings').select('*').order('updated_at', { ascending: false });
      if (error) throw error;
      return (data || []) as SEOSetting[];
    },
  });
}

async function callSeoAI(payload: Record<string, string>) {
  const { data, error } = await supabase.functions.invoke('generate-seo-jsonld', { body: payload });
  if (error) throw new Error(error.message || 'AI-Fehler');
  if (data?.error) throw new Error(data.error);
  return data?.result as string;
}

function SettingForm({ setting, onSave, onClose }: {
  setting?: SEOSetting; onSave: (data: Partial<SEOSetting>) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({
    page_type: setting?.page_type || 'homepage',
    meta_title: setting?.meta_title || '',
    meta_description: setting?.meta_description || '',
    canonical_url: setting?.canonical_url || '',
    og_image: setting?.og_image || '',
    keywords: setting?.keywords?.join(', ') || '',
    robots_directives: setting?.robots_directives || 'index, follow',
    structured_data: setting?.structured_data ? JSON.stringify(setting.structured_data, null, 2) : '',
  });

  const [aiLoading, setAiLoading] = useState<string | null>(null);

  const handleGenerateJsonLD = async () => {
    setAiLoading('jsonld');
    try {
      const result = await callSeoAI({
        action: 'generate_jsonld',
        page_type: form.page_type,
        meta_title: form.meta_title,
        meta_description: form.meta_description,
        keywords: form.keywords,
        canonical_url: form.canonical_url,
      });
      // Extract JSON from potential markdown wrapping
      let cleaned = result.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }
      // Validate JSON
      const parsed = JSON.parse(cleaned);
      setForm(f => ({ ...f, structured_data: JSON.stringify(parsed, null, 2) }));
      toast.success('JSON-LD generiert');
    } catch (e: any) {
      toast.error(e.message || 'JSON-LD Generierung fehlgeschlagen');
    } finally {
      setAiLoading(null);
    }
  };

  const handleGenerateMeta = async () => {
    setAiLoading('meta');
    try {
      const result = await callSeoAI({
        action: 'generate_meta',
        page_type: form.page_type,
        keywords: form.keywords,
        canonical_url: form.canonical_url,
      });
      let cleaned = result.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }
      const parsed = JSON.parse(cleaned);
      if (parsed.meta_title) setForm(f => ({ ...f, meta_title: parsed.meta_title }));
      if (parsed.meta_description) setForm(f => ({ ...f, meta_description: parsed.meta_description }));
      toast.success('Meta-Tags generiert');
    } catch (e: any) {
      toast.error(e.message || 'Meta-Generierung fehlgeschlagen');
    } finally {
      setAiLoading(null);
    }
  };

  const handleImproveMeta = async () => {
    if (!form.meta_title && !form.meta_description) {
      toast.error('Bitte zuerst Title oder Description eingeben');
      return;
    }
    setAiLoading('improve');
    try {
      const result = await callSeoAI({
        action: 'improve_meta',
        page_type: form.page_type,
        meta_title: form.meta_title,
        meta_description: form.meta_description,
        keywords: form.keywords,
      });
      let cleaned = result.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }
      const parsed = JSON.parse(cleaned);
      if (parsed.meta_title) setForm(f => ({ ...f, meta_title: parsed.meta_title }));
      if (parsed.meta_description) setForm(f => ({ ...f, meta_description: parsed.meta_description }));
      toast.success('Meta-Tags verbessert');
    } catch (e: any) {
      toast.error(e.message || 'Verbesserung fehlgeschlagen');
    } finally {
      setAiLoading(null);
    }
  };

  const handleSubmit = () => {
    let structured = null;
    if (form.structured_data) {
      try { structured = JSON.parse(form.structured_data); }
      catch { toast.error('Ungültiges JSON in Structured Data'); return; }
    }
    onSave({
      ...form,
      keywords: form.keywords ? form.keywords.split(',').map(k => k.trim()).filter(Boolean) : [],
      structured_data: structured,
    } as any);
    onClose();
  };

  const isAnyLoading = aiLoading !== null;

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {/* AI Quick Actions Bar */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-2 flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> KI-Assistent
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] h-7 gap-1 border-primary/30 hover:bg-primary/10"
              disabled={isAnyLoading}
              onClick={handleGenerateMeta}
            >
              {aiLoading === 'meta' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              Meta-Tags generieren
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] h-7 gap-1 border-primary/30 hover:bg-primary/10"
              disabled={isAnyLoading}
              onClick={handleImproveMeta}
            >
              {aiLoading === 'improve' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Meta verbessern
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] h-7 gap-1 border-primary/30 hover:bg-primary/10"
              disabled={isAnyLoading}
              onClick={handleGenerateJsonLD}
            >
              {aiLoading === 'jsonld' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Code className="h-3 w-3" />}
              JSON-LD generieren
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Seitentyp</Label>
          <Select value={form.page_type} onValueChange={v => setForm(f => ({ ...f, page_type: v }))}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="homepage">Homepage</SelectItem>
              <SelectItem value="shop">Shop</SelectItem>
              <SelectItem value="blog">Blog</SelectItem>
              <SelectItem value="course">Kurs</SelectItem>
              <SelectItem value="landing">Landing Page</SelectItem>
              <SelectItem value="legal">Rechtliches</SelectItem>
              <SelectItem value="about">Über uns</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Robots</Label>
          <Select value={form.robots_directives} onValueChange={v => setForm(f => ({ ...f, robots_directives: v }))}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="index, follow">index, follow</SelectItem>
              <SelectItem value="noindex, follow">noindex, follow</SelectItem>
              <SelectItem value="index, nofollow">index, nofollow</SelectItem>
              <SelectItem value="noindex, nofollow">noindex, nofollow</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Meta-Title ({form.meta_title.length}/60)</Label>
        <Input value={form.meta_title} onChange={e => setForm(f => ({ ...f, meta_title: e.target.value }))} />
        {form.meta_title.length > 60 && <p className="text-[10px] text-rose-500">Zu lang – max. 60 Zeichen</p>}
        {form.meta_title.length > 0 && form.meta_title.length <= 60 && (
          <p className="text-[10px] text-emerald-500">✓ Länge OK</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Meta-Description ({form.meta_description.length}/160)</Label>
        <Textarea value={form.meta_description} onChange={e => setForm(f => ({ ...f, meta_description: e.target.value }))} rows={2} />
        {form.meta_description.length > 160 && <p className="text-[10px] text-rose-500">Zu lang – max. 160 Zeichen</p>}
        {form.meta_description.length > 0 && form.meta_description.length <= 160 && (
          <p className="text-[10px] text-emerald-500">✓ Länge OK</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Canonical URL</Label>
          <Input value={form.canonical_url} onChange={e => setForm(f => ({ ...f, canonical_url: e.target.value }))} placeholder="https://examfit.de/..." />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">OG-Image</Label>
          <Input value={form.og_image} onChange={e => setForm(f => ({ ...f, og_image: e.target.value }))} placeholder="https://..." />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Keywords (kommagetrennt)</Label>
        <Input value={form.keywords} onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))} placeholder="IHK, Prüfung, Weiterbildung" />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs flex items-center gap-1"><Code className="h-3 w-3" /> Structured Data (JSON-LD)</Label>
          <Button
            variant="ghost"
            size="sm"
            className="text-[10px] h-6 gap-1 text-primary"
            disabled={isAnyLoading}
            onClick={handleGenerateJsonLD}
          >
            {aiLoading === 'jsonld' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            KI generieren
          </Button>
        </div>
        <Textarea
          value={form.structured_data}
          onChange={e => setForm(f => ({ ...f, structured_data: e.target.value }))}
          rows={8}
          className="font-mono text-xs"
          placeholder='{"@context": "https://schema.org", ...}'
        />
        {form.structured_data && (() => {
          try { JSON.parse(form.structured_data); return <p className="text-[10px] text-emerald-500">✓ Valides JSON</p>; }
          catch { return <p className="text-[10px] text-rose-500">✗ Ungültiges JSON</p>; }
        })()}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onClose}>Abbrechen</Button>
        <Button size="sm" onClick={handleSubmit}>{setting ? 'Speichern' : 'Erstellen'}</Button>
      </div>
    </div>
  );
}

export default function SEOSettingsManager() {
  const { data: settings, isLoading } = useSEOSettings();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const createMut = useMutation({
    mutationFn: async (data: Partial<SEOSetting>) => {
      const { error } = await supabase.from('seo_settings').insert(data as any).select().single();
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['seo-settings'] }); toast.success('Einstellung erstellt'); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SEOSetting> & { id: string }) => {
      const { error } = await supabase.from('seo_settings').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['seo-settings'] }); toast.success('Einstellung gespeichert'); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-40" />;

  const withMissing = (settings || []).filter(s => !s.meta_title || !s.meta_description);

  return (
    <div className="space-y-4">
      {withMissing.length > 0 && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-center gap-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <strong>{withMissing.length}</strong> Seiten ohne vollständige Meta-Daten
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end">
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="text-xs gap-1"><Plus className="h-3 w-3" /> Neue Einstellung</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Neue SEO-Einstellung</DialogTitle></DialogHeader>
            <SettingForm onSave={data => createMut.mutate(data)} onClose={() => setShowCreate(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-1">
        {(settings || []).map(s => (
          <Card key={s.id} className="hover:bg-muted/20 transition-colors">
            <CardContent className="py-2 px-4 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Settings className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px]">{s.page_type}</Badge>
                    <span className="text-xs font-semibold truncate">{s.meta_title || 'Kein Title'}</span>
                    {s.meta_title && s.meta_description ? (
                      <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                    )}
                    {s.structured_data && <Code className="h-3 w-3 text-primary shrink-0" />}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{s.meta_description || 'Keine Description'}</p>
                </div>
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7"><Pencil className="h-3 w-3" /></Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>SEO bearbeiten</DialogTitle></DialogHeader>
                  <SettingForm setting={s} onSave={data => updateMut.mutate({ id: s.id, ...data })} onClose={() => {}} />
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
