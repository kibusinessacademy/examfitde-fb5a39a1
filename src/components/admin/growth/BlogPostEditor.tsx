import React, { useState } from 'react';
import { useBlogPosts, useBlogPostMutations, type BlogPost } from '@/hooks/useContentStudio';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Plus, Pencil, Trash2, Eye, Send, FileText, Search,
  ExternalLink, Loader2, CheckCircle, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

const statusColors: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  review: 'bg-amber-500/15 text-amber-600',
  published: 'bg-emerald-500/15 text-emerald-600',
  archived: 'bg-rose-500/15 text-rose-600',
};

function seoScore(post: BlogPost): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 100;
  if (!post.meta_title) { score -= 20; issues.push('Meta-Title fehlt'); }
  else if (post.meta_title.length > 60) { score -= 10; issues.push(`Meta-Title zu lang (${post.meta_title.length})`); }
  if (!post.meta_description) { score -= 20; issues.push('Meta-Description fehlt'); }
  else if (post.meta_description.length > 160) { score -= 10; issues.push(`Meta-Description zu lang (${post.meta_description.length})`); }
  if (!post.og_image_url) { score -= 15; issues.push('OG-Image fehlt'); }
  if (!post.excerpt) { score -= 10; issues.push('Excerpt fehlt'); }
  if (!post.canonical_url) { score -= 5; issues.push('Canonical URL fehlt'); }
  if (post.noindex) { score -= 20; issues.push('Noindex aktiv'); }
  if (!post.tags || post.tags.length === 0) { score -= 5; issues.push('Keine Tags'); }
  return { score: Math.max(0, score), issues };
}

function BlogForm({ post, onSave, onClose }: {
  post?: BlogPost; onSave: (data: Partial<BlogPost>) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({
    title: post?.title || '',
    slug: post?.slug || '',
    meta_title: post?.meta_title || '',
    meta_description: post?.meta_description || '',
    excerpt: post?.excerpt || '',
    body_md: post?.body_md || '',
    category: post?.category || '',
    tags: post?.tags?.join(', ') || '',
    author_name: post?.author_name || '',
    og_image_url: post?.og_image_url || '',
    canonical_url: post?.canonical_url || '',
    noindex: post?.noindex || false,
    status: post?.status || 'draft',
  });

  const handleSubmit = () => {
    if (!form.title || !form.slug) { toast.error('Titel und Slug sind Pflicht'); return; }
    onSave({
      ...form,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    });
    onClose();
  };

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Titel *</Label>
          <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Blogartikel-Titel" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Slug *</Label>
          <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="url-slug" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Meta-Title <span className="text-muted-foreground">({form.meta_title.length}/60)</span></Label>
          <Input value={form.meta_title} onChange={e => setForm(f => ({ ...f, meta_title: e.target.value }))} placeholder="SEO Title" />
          {form.meta_title.length > 60 && <p className="text-[10px] text-rose-500">Zu lang für Google SERP</p>}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Kategorie</Label>
          <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="z.B. IHK, Lerntipps" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Meta-Description <span className="text-muted-foreground">({form.meta_description.length}/160)</span></Label>
        <Textarea value={form.meta_description} onChange={e => setForm(f => ({ ...f, meta_description: e.target.value }))} rows={2} placeholder="SEO Beschreibung" />
        {form.meta_description.length > 160 && <p className="text-[10px] text-rose-500">Zu lang für Google SERP</p>}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Excerpt</Label>
        <Textarea value={form.excerpt} onChange={e => setForm(f => ({ ...f, excerpt: e.target.value }))} rows={2} placeholder="Kurzbeschreibung" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Inhalt (Markdown)</Label>
        <Textarea value={form.body_md} onChange={e => setForm(f => ({ ...f, body_md: e.target.value }))} rows={10} placeholder="# Überschrift..." className="font-mono text-xs" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Tags (kommagetrennt)</Label>
          <Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="IHK, Prüfung, Tipps" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Autor</Label>
          <Input value={form.author_name} onChange={e => setForm(f => ({ ...f, author_name: e.target.value }))} placeholder="Max Mustermann" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">OG-Image URL</Label>
          <Input value={form.og_image_url} onChange={e => setForm(f => ({ ...f, og_image_url: e.target.value }))} placeholder="https://..." />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Canonical URL</Label>
          <Input value={form.canonical_url} onChange={e => setForm(f => ({ ...f, canonical_url: e.target.value }))} placeholder="https://examfit.de/blog/..." />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch checked={form.noindex} onCheckedChange={v => setForm(f => ({ ...f, noindex: v }))} />
          <Label className="text-xs">Noindex</Label>
        </div>
        <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Entwurf</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="published">Veröffentlicht</SelectItem>
            <SelectItem value="archived">Archiviert</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onClose}>Abbrechen</Button>
        <Button size="sm" onClick={handleSubmit}>{post ? 'Speichern' : 'Erstellen'}</Button>
      </div>
    </div>
  );
}

export default function BlogPostEditor() {
  const { data: posts, isLoading } = useBlogPosts();
  const { create, update, publish, remove } = useBlogPostMutations();
  const [search, setSearch] = useState('');
  const [editPost, setEditPost] = useState<BlogPost | null>(null);
  const [filter, setFilter] = useState<string>('all');

  if (isLoading) return <Skeleton className="h-60" />;

  const all = posts || [];
  const publishedCount = all.filter(p => p.status === 'published').length;
  const draftCount = all.filter(p => p.status !== 'published').length;
  const totalWords = all.reduce((s, p) => s + ((p as any)._word_count || 0), 0);

  const filtered = all.filter(p => {
    if (filter !== 'all' && p.status !== filter) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.slug.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="border-border">
          <CardContent className="p-3">
            <div className="text-lg font-bold text-foreground">{all.length}</div>
            <div className="text-[10px] text-muted-foreground">Artikel gesamt</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20">
          <CardContent className="p-3">
            <div className="text-lg font-bold text-emerald-600">{publishedCount}</div>
            <div className="text-[10px] text-muted-foreground">Published</div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20">
          <CardContent className="p-3">
            <div className="text-lg font-bold text-amber-600">{draftCount}</div>
            <div className="text-[10px] text-muted-foreground">Entwürfe</div>
          </CardContent>
        </Card>
        <Card className="border-primary/20">
          <CardContent className="p-3">
            <div className="text-lg font-bold text-foreground">{totalWords.toLocaleString('de-DE')}</div>
            <div className="text-[10px] text-muted-foreground">Wörter gesamt</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Suchen..." className="pl-8 h-8 text-xs" />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              <SelectItem value="draft">Entwurf</SelectItem>
              <SelectItem value="review">Review</SelectItem>
              <SelectItem value="published">Live</SelectItem>
              <SelectItem value="archived">Archiv</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="text-xs gap-1"><Plus className="h-3 w-3" /> Neuer Artikel</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Neuer Blogartikel</DialogTitle></DialogHeader>
            <BlogForm onSave={data => create.mutate(data)} onClose={() => setShowCreate(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card className="border-dashed"><CardContent className="py-8 text-center text-sm text-muted-foreground">Keine Blogartikel gefunden</CardContent></Card>
        )}
        {filtered.map(post => {
          const seo = seoScore(post);
          const extra = post as any;
          return (
            <Card key={post.id} className="hover:bg-muted/20 transition-colors">
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate">{post.title}</span>
                      <Badge className={cn('text-[9px]', statusColors[post.status])}>{post.status}</Badge>
                      <Badge variant="outline" className={cn('text-[9px]',
                        seo.score >= 80 ? 'text-emerald-600' : seo.score >= 50 ? 'text-amber-600' : 'text-rose-600'
                      )}>
                        SEO {seo.score}%
                      </Badge>
                      {post.category && (
                        <Badge variant="outline" className="text-[9px]">{post.category}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <p className="text-[10px] text-muted-foreground">/{post.slug}</p>
                      {extra._word_count > 0 && (
                        <span className="text-[9px] text-muted-foreground">{extra._word_count} Wörter</span>
                      )}
                      {extra._reading_time > 0 && (
                        <span className="text-[9px] text-muted-foreground">{extra._reading_time} min</span>
                      )}
                      {extra._views > 0 && (
                        <span className="text-[9px] text-muted-foreground">👁 {extra._views}</span>
                      )}
                    </div>
                    {seo.issues.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {seo.issues.slice(0, 3).map((issue, i) => (
                          <span key={i} className="text-[9px] text-amber-600 bg-amber-500/10 rounded px-1.5 py-0.5">{issue}</span>
                        ))}
                        {seo.issues.length > 3 && <span className="text-[9px] text-muted-foreground">+{seo.issues.length - 3}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a href={`/wissen/${post.slug}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Live ansehen"><ExternalLink className="h-3 w-3" /></Button>
                    </a>
                    {post.status !== 'published' && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => publish.mutate(post.id)} title="Veröffentlichen">
                        <Send className="h-3 w-3" />
                      </Button>
                    )}
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditPost(post)}><Pencil className="h-3 w-3" /></Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader><DialogTitle>Artikel bearbeiten</DialogTitle></DialogHeader>
                        <BlogForm post={post} onSave={data => update.mutate({ id: post.id, ...data })} onClose={() => setEditPost(null)} />
                      </DialogContent>
                    </Dialog>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { if (confirm('Wirklich löschen?')) remove.mutate(post.id); }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
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
