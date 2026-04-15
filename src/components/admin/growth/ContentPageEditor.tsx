import React, { useState } from 'react';
import { useContentPages, useContentPageMutations, type ContentPage } from '@/hooks/useContentStudio';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Plus, Pencil, Trash2, Send, Search, Globe, ExternalLink, Database, Star } from 'lucide-react';
import { toast } from 'sonner';

function PageForm({ page, onSave, onClose }: {
  page?: ContentPage; onSave: (data: Partial<ContentPage>) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({
    title: page?.title || '',
    slug: page?.slug || '',
    page_type: page?.page_type || 'landing',
    meta_title: page?.meta_title || '',
    meta_description: page?.meta_description || '',
    body_md: page?.body_md || '',
    og_image_url: page?.og_image_url || '',
    canonical_url: page?.canonical_url || '',
    audience: page?.audience || 'b2c',
    language: page?.language || 'de',
    noindex: page?.noindex || false,
    status: page?.status || 'draft',
  });

  const handleSubmit = () => {
    if (!form.title || !form.slug) { toast.error('Titel und Slug sind Pflicht'); return; }
    onSave(form);
    onClose();
  };

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Titel *</Label>
          <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Slug *</Label>
          <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Seitentyp</Label>
          <Select value={form.page_type} onValueChange={v => setForm(f => ({ ...f, page_type: v }))}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="landing">Landing Page</SelectItem>
              <SelectItem value="about">Über uns</SelectItem>
              <SelectItem value="legal">Rechtliches</SelectItem>
              <SelectItem value="support">Support</SelectItem>
              <SelectItem value="product">Produkt</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Zielgruppe</Label>
          <Select value={form.audience} onValueChange={v => setForm(f => ({ ...f, audience: v }))}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="b2c">B2C</SelectItem>
              <SelectItem value="b2b">B2B</SelectItem>
              <SelectItem value="all">Alle</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Entwurf</SelectItem>
              <SelectItem value="review">Review</SelectItem>
              <SelectItem value="published">Live</SelectItem>
              <SelectItem value="archived">Archiv</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Meta-Title ({form.meta_title.length}/60)</Label>
          <Input value={form.meta_title} onChange={e => setForm(f => ({ ...f, meta_title: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">OG-Image URL</Label>
          <Input value={form.og_image_url} onChange={e => setForm(f => ({ ...f, og_image_url: e.target.value }))} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Meta-Description ({form.meta_description.length}/160)</Label>
        <Textarea value={form.meta_description} onChange={e => setForm(f => ({ ...f, meta_description: e.target.value }))} rows={2} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Inhalt (Markdown)</Label>
        <Textarea value={form.body_md} onChange={e => setForm(f => ({ ...f, body_md: e.target.value }))} rows={10} className="font-mono text-xs" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Canonical URL</Label>
        <Input value={form.canonical_url} onChange={e => setForm(f => ({ ...f, canonical_url: e.target.value }))} />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={form.noindex} onCheckedChange={v => setForm(f => ({ ...f, noindex: v }))} />
        <Label className="text-xs">Noindex</Label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onClose}>Abbrechen</Button>
        <Button size="sm" onClick={handleSubmit}>{page ? 'Speichern' : 'Erstellen'}</Button>
      </div>
    </div>
  );
}

const statusColors: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  review: 'bg-amber-500/15 text-amber-600',
  published: 'bg-emerald-500/15 text-emerald-600',
  archived: 'bg-rose-500/15 text-rose-600',
};

const sourceColors: Record<string, string> = {
  content_pages: 'border-primary/30 text-primary',
  certification_seo: 'border-emerald-500/30 text-emerald-600',
};

export default function ContentPageEditor() {
  const { data: pages, isLoading } = useContentPages();
  const { create, update, publish, remove } = useContentPageMutations();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  if (isLoading) return <Skeleton className="h-60" />;

  const filtered = (pages || []).filter(p => {
    if (sourceFilter !== 'all' && p._source !== sourceFilter) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.slug.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const seoCount = (pages || []).filter(p => p._source === 'certification_seo').length;
  const customCount = (pages || []).filter(p => p._source === 'content_pages').length;

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="text-lg font-bold text-foreground">{(pages || []).length}</div>
            <div className="text-[10px] text-muted-foreground">Gesamt</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20">
          <CardContent className="p-3">
            <div className="text-lg font-bold text-foreground">{seoCount}</div>
            <div className="text-[10px] text-muted-foreground">SEO Landing Pages</div>
          </CardContent>
        </Card>
        <Card className="border-primary/20">
          <CardContent className="p-3">
            <div className="text-lg font-bold text-foreground">{customCount}</div>
            <div className="text-[10px] text-muted-foreground">Custom Pages</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Seite suchen..." className="pl-8 h-8 text-xs" />
          </div>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Quellen</SelectItem>
              <SelectItem value="certification_seo">SEO Landing Pages</SelectItem>
              <SelectItem value="content_pages">Custom Pages</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="text-xs gap-1"><Plus className="h-3 w-3" /> Neue Seite</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Neue Seite</DialogTitle></DialogHeader>
            <PageForm onSave={data => create.mutate(data)} onClose={() => setShowCreate(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && <Card className="border-dashed"><CardContent className="py-8 text-center text-sm text-muted-foreground">Keine Seiten gefunden</CardContent></Card>}
        {filtered.map(page => {
          const isSeo = page._source === 'certification_seo';
          return (
            <Card key={page.id} className="hover:bg-muted/20 transition-colors">
              <CardContent className="py-3 px-4 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-semibold truncate">{page.title}</span>
                    <Badge className={cn('text-[9px]', statusColors[page.status])}>{page.status}</Badge>
                    <Badge variant="outline" className="text-[9px]">{page.page_type}</Badge>
                    <Badge variant="outline" className={cn('text-[9px]', sourceColors[page._source || 'content_pages'])}>
                      {isSeo ? <Database className="h-2.5 w-2.5 mr-0.5" /> : null}
                      {isSeo ? 'SEO' : 'Custom'}
                    </Badge>
                    {page._quality_score != null && (
                      <Badge variant="outline" className={cn('text-[9px]',
                        page._quality_score >= 80 ? 'text-emerald-600 border-emerald-500/30' :
                        page._quality_score >= 50 ? 'text-amber-600 border-amber-500/30' :
                        'text-rose-600 border-destructive/30'
                      )}>
                        <Star className="h-2.5 w-2.5 mr-0.5" />{page._quality_score}%
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-[10px] text-muted-foreground ml-5">/{page.slug}</p>
                    {page._word_count != null && (
                      <span className="text-[9px] text-muted-foreground">{page._word_count} Wörter</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isSeo && (
                    <a href={`/pruefung/${page.slug}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Live ansehen"><ExternalLink className="h-3 w-3" /></Button>
                    </a>
                  )}
                  {!isSeo && page.status !== 'published' && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => publish.mutate(page.id)} title="Veröffentlichen"><Send className="h-3 w-3" /></Button>
                  )}
                  {!isSeo && (
                    <>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7"><Pencil className="h-3 w-3" /></Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader><DialogTitle>Seite bearbeiten</DialogTitle></DialogHeader>
                          <PageForm page={page} onSave={data => update.mutate({ id: page.id, ...data })} onClose={() => {}} />
                        </DialogContent>
                      </Dialog>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { if (confirm('Löschen?')) remove.mutate(page.id); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
