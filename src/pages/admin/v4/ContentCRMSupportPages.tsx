import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  FileText, Edit, Image, Globe, Plus, Eye, Trash2,
  CheckCircle2, Clock, Send, Archive, ArrowRight, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useContentPages, useContentPageMutations,
  useBlogPosts, useBlogPostMutations,
  useContentAssets, useContentAssetMutations,
  useSEORedirects, useSEORedirectMutations,
  type ContentPage, type BlogPost, type ContentAsset, type SEORedirect,
} from '@/hooks/useContentStudio';

// ═══ Status Badge ═══
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: React.ElementType; className: string }> = {
    draft: { icon: Clock, className: 'bg-muted text-muted-foreground' },
    review: { icon: Eye, className: 'bg-yellow-500/10 text-yellow-600' },
    published: { icon: CheckCircle2, className: 'bg-emerald-500/10 text-emerald-600' },
    archived: { icon: Archive, className: 'bg-muted text-muted-foreground' },
  };
  const c = config[status] || config.draft;
  const Icon = c.icon;
  return (
    <Badge variant="outline" className={cn('text-[10px] gap-1', c.className)}>
      <Icon className="h-3 w-3" /> {status}
    </Badge>
  );
}

// ═══ SEO Checklist ═══
function SEOChecklist({ title, metaTitle, metaDescription, slug }: {
  title?: string; metaTitle?: string | null; metaDescription?: string | null; slug?: string;
}) {
  const checks = [
    { label: 'Title vorhanden', ok: !!title && title.length > 0 },
    { label: 'Meta Title ≤60 Zeichen', ok: !!metaTitle && metaTitle.length <= 60 && metaTitle.length > 0 },
    { label: 'Meta Description ≤160 Zeichen', ok: !!metaDescription && metaDescription.length <= 160 && metaDescription.length > 0 },
    { label: 'Slug vorhanden', ok: !!slug && slug.length > 0 },
  ];
  const passed = checks.filter(c => c.ok).length;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">SEO ({passed}/{checks.length})</p>
      {checks.map((c, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          {c.ok
            ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            : <AlertTriangle className="h-3 w-3 text-yellow-500" />}
          <span className={c.ok ? 'text-muted-foreground' : 'text-foreground'}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

// ═══ Content Pages List ═══
export function ContentPagesList() {
  const { data: pages = [], isLoading } = useContentPages();
  const { create, update, publish, remove } = useContentPageMutations();
  const [editing, setEditing] = useState<Partial<ContentPage> | null>(null);
  const [filter, setFilter] = useState('');

  const filtered = pages.filter(p =>
    p.title.toLowerCase().includes(filter.toLowerCase()) ||
    p.slug.toLowerCase().includes(filter.toLowerCase())
  );

  const statusCounts = {
    draft: pages.filter(p => p.status === 'draft').length,
    review: pages.filter(p => p.status === 'review').length,
    published: pages.filter(p => p.status === 'published').length,
  };

  const handleSave = () => {
    if (!editing) return;
    if (editing.id) {
      update.mutate(editing as ContentPage & { id: string });
    } else {
      create.mutate(editing);
    }
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Entwurf</p>
          <p className="text-2xl font-bold text-foreground">{statusCounts.draft}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Review</p>
          <p className="text-2xl font-bold text-yellow-600">{statusCounts.review}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Veröffentlicht</p>
          <p className="text-2xl font-bold text-emerald-600">{statusCounts.published}</p>
        </CardContent></Card>
      </div>

      <div className="flex items-center gap-2">
        <Input placeholder="Seiten durchsuchen…" value={filter} onChange={e => setFilter(e.target.value)} className="max-w-xs" />
        <Button size="sm" onClick={() => setEditing({ title: '', slug: '', page_type: 'landing', status: 'draft', body_md: '', audience: 'azubi' })}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Neue Seite
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-3 px-4">Titel</th>
                <th className="text-left py-3 px-4 hidden md:table-cell">Slug</th>
                <th className="text-left py-3 px-4 hidden lg:table-cell">Typ</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-right py-3 px-4">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Laden…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Keine Seiten gefunden</td></tr>
              ) : filtered.map(page => (
                <tr key={page.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 px-4 font-medium">{page.title}</td>
                  <td className="py-2.5 px-4 text-xs text-muted-foreground font-mono hidden md:table-cell">/{page.slug}</td>
                  <td className="py-2.5 px-4 hidden lg:table-cell"><Badge variant="outline" className="text-[10px]">{page.page_type}</Badge></td>
                  <td className="py-2.5 px-4"><StatusBadge status={page.status} /></td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(page)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      {page.status !== 'published' && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-600" onClick={() => publish.mutate(page.id)}>
                          <Send className="h-3 w-3" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => remove.mutate(page.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Seite bearbeiten' : 'Neue Seite'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-4">
                <div><label className="text-xs font-medium text-muted-foreground">Titel</label>
                  <Input value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} /></div>
                <div><label className="text-xs font-medium text-muted-foreground">Slug</label>
                  <Input value={editing.slug || ''} onChange={e => setEditing({ ...editing, slug: e.target.value })} placeholder="mein-slug" /></div>
                <div><label className="text-xs font-medium text-muted-foreground">Meta Title</label>
                  <Input value={editing.meta_title || ''} onChange={e => setEditing({ ...editing, meta_title: e.target.value })} />
                  <p className="text-[10px] text-muted-foreground mt-1">{(editing.meta_title || '').length}/60</p></div>
                <div><label className="text-xs font-medium text-muted-foreground">Meta Description</label>
                  <Textarea value={editing.meta_description || ''} onChange={e => setEditing({ ...editing, meta_description: e.target.value })} rows={2} />
                  <p className="text-[10px] text-muted-foreground mt-1">{(editing.meta_description || '').length}/160</p></div>
                <div><label className="text-xs font-medium text-muted-foreground">Inhalt (Markdown)</label>
                  <Textarea value={editing.body_md || ''} onChange={e => setEditing({ ...editing, body_md: e.target.value })} rows={12} className="font-mono text-xs" /></div>
              </div>
              <div className="space-y-4">
                <div><label className="text-xs font-medium text-muted-foreground">Seitentyp</label>
                  <Select value={editing.page_type || 'landing'} onValueChange={v => setEditing({ ...editing, page_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="landing">Landing Page</SelectItem>
                      <SelectItem value="product">Produktseite</SelectItem>
                      <SelectItem value="legal">Rechtstexte</SelectItem>
                      <SelectItem value="faq">FAQ</SelectItem>
                      <SelectItem value="impressum">Impressum</SelectItem>
                    </SelectContent>
                  </Select></div>
                <div><label className="text-xs font-medium text-muted-foreground">Status</label>
                  <Select value={editing.status || 'draft'} onValueChange={v => setEditing({ ...editing, status: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Entwurf</SelectItem>
                      <SelectItem value="review">Review</SelectItem>
                      <SelectItem value="published">Veröffentlicht</SelectItem>
                      <SelectItem value="archived">Archiviert</SelectItem>
                    </SelectContent>
                  </Select></div>
                <div><label className="text-xs font-medium text-muted-foreground">Zielgruppe</label>
                  <Select value={editing.audience || 'azubi'} onValueChange={v => setEditing({ ...editing, audience: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="azubi">Auszubildende</SelectItem>
                      <SelectItem value="betrieb">Betriebe</SelectItem>
                      <SelectItem value="institutionen">Institutionen</SelectItem>
                      <SelectItem value="alle">Alle</SelectItem>
                    </SelectContent>
                  </Select></div>
                <div><label className="text-xs font-medium text-muted-foreground">Canonical URL</label>
                  <Input value={editing.canonical_url || ''} onChange={e => setEditing({ ...editing, canonical_url: e.target.value })} placeholder="https://…" /></div>
                <SEOChecklist title={editing.title} metaTitle={editing.meta_title} metaDescription={editing.meta_description} slug={editing.slug} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Abbrechen</Button>
            <Button onClick={handleSave}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══ Blog Posts List ═══
export function BlogPostsList() {
  const { data: posts = [], isLoading } = useBlogPosts();
  const { create, update, publish, remove } = useBlogPostMutations();
  const [editing, setEditing] = useState<Partial<BlogPost> | null>(null);
  const [filter, setFilter] = useState('');

  const filtered = posts.filter(p => p.title.toLowerCase().includes(filter.toLowerCase()));

  const handleSave = () => {
    if (!editing) return;
    if (editing.id) { update.mutate(editing as BlogPost & { id: string }); }
    else { create.mutate(editing); }
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input placeholder="Artikel durchsuchen…" value={filter} onChange={e => setFilter(e.target.value)} className="max-w-xs" />
        <Button size="sm" onClick={() => setEditing({ title: '', slug: '', status: 'draft', body_md: '', tags: [] })}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Neuer Artikel
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-3 px-4">Titel</th>
                <th className="text-left py-3 px-4 hidden md:table-cell">Slug</th>
                <th className="text-left py-3 px-4 hidden lg:table-cell">Kategorie</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-right py-3 px-4">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Laden…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">Keine Artikel</td></tr>
              ) : filtered.map(post => (
                <tr key={post.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 px-4 font-medium">{post.title}</td>
                  <td className="py-2.5 px-4 text-xs text-muted-foreground font-mono hidden md:table-cell">/{post.slug}</td>
                  <td className="py-2.5 px-4 text-xs hidden lg:table-cell">{post.category || '—'}</td>
                  <td className="py-2.5 px-4"><StatusBadge status={post.status} /></td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(post)}><Edit className="h-3 w-3" /></Button>
                      {post.status !== 'published' && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-600" onClick={() => publish.mutate(post.id)}><Send className="h-3 w-3" /></Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => remove.mutate(post.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? 'Artikel bearbeiten' : 'Neuer Artikel'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-4">
                <div><label className="text-xs font-medium text-muted-foreground">Titel</label>
                  <Input value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} /></div>
                <div><label className="text-xs font-medium text-muted-foreground">Slug</label>
                  <Input value={editing.slug || ''} onChange={e => setEditing({ ...editing, slug: e.target.value })} /></div>
                <div><label className="text-xs font-medium text-muted-foreground">Excerpt</label>
                  <Textarea value={editing.excerpt || ''} onChange={e => setEditing({ ...editing, excerpt: e.target.value })} rows={2} /></div>
                <div><label className="text-xs font-medium text-muted-foreground">Inhalt (Markdown)</label>
                  <Textarea value={editing.body_md || ''} onChange={e => setEditing({ ...editing, body_md: e.target.value })} rows={12} className="font-mono text-xs" /></div>
              </div>
              <div className="space-y-4">
                <div><label className="text-xs font-medium text-muted-foreground">Meta Title</label>
                  <Input value={editing.meta_title || ''} onChange={e => setEditing({ ...editing, meta_title: e.target.value })} />
                  <p className="text-[10px] text-muted-foreground mt-1">{(editing.meta_title || '').length}/60</p></div>
                <div><label className="text-xs font-medium text-muted-foreground">Meta Description</label>
                  <Textarea value={editing.meta_description || ''} onChange={e => setEditing({ ...editing, meta_description: e.target.value })} rows={2} />
                  <p className="text-[10px] text-muted-foreground mt-1">{(editing.meta_description || '').length}/160</p></div>
                <div><label className="text-xs font-medium text-muted-foreground">Kategorie</label>
                  <Input value={editing.category || ''} onChange={e => setEditing({ ...editing, category: e.target.value })} /></div>
                <div><label className="text-xs font-medium text-muted-foreground">Status</label>
                  <Select value={editing.status || 'draft'} onValueChange={v => setEditing({ ...editing, status: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Entwurf</SelectItem>
                      <SelectItem value="review">Review</SelectItem>
                      <SelectItem value="published">Veröffentlicht</SelectItem>
                      <SelectItem value="archived">Archiviert</SelectItem>
                    </SelectContent>
                  </Select></div>
                <SEOChecklist title={editing.title} metaTitle={editing.meta_title} metaDescription={editing.meta_description} slug={editing.slug} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Abbrechen</Button>
            <Button onClick={handleSave}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══ Assets Manager ═══
export function AssetsManager() {
  const { data: assets = [], isLoading } = useContentAssets();
  const { create, update, remove } = useContentAssetMutations();
  const [editing, setEditing] = useState<Partial<ContentAsset> | null>(null);

  const missingAlt = assets.filter(a => !a.alt_text || a.alt_text.trim() === '').length;

  const handleSave = () => {
    if (!editing) return;
    if (editing.id) { update.mutate(editing as ContentAsset & { id: string }); }
    else { create.mutate(editing); }
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => setEditing({ file_name: '', file_path: '', keywords: [] })}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Asset hinzufügen
        </Button>
        {missingAlt > 0 && (
          <Badge variant="outline" className="text-yellow-600 bg-yellow-500/10">
            <AlertTriangle className="h-3 w-3 mr-1" /> {missingAlt} ohne Alt-Text
          </Badge>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-3 px-4">Datei</th>
                <th className="text-left py-3 px-4">Alt-Text</th>
                <th className="text-left py-3 px-4 hidden lg:table-cell">Keywords</th>
                <th className="text-right py-3 px-4">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">Laden…</td></tr>
              ) : assets.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">Keine Assets</td></tr>
              ) : assets.map(asset => (
                <tr key={asset.id} className={cn("border-b border-border/50 hover:bg-muted/30", !asset.alt_text && "bg-yellow-500/5")}>
                  <td className="py-2.5 px-4 font-mono text-xs">{asset.file_name}</td>
                  <td className="py-2.5 px-4 text-xs">{asset.alt_text || <span className="text-yellow-600">Fehlt!</span>}</td>
                  <td className="py-2.5 px-4 text-xs hidden lg:table-cell">{(asset.keywords || []).join(', ') || '—'}</td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(asset)}><Edit className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => remove.mutate(asset.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? 'Asset bearbeiten' : 'Neues Asset'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div><label className="text-xs font-medium text-muted-foreground">Dateiname</label>
                <Input value={editing.file_name || ''} onChange={e => setEditing({ ...editing, file_name: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Dateipfad</label>
                <Input value={editing.file_path || ''} onChange={e => setEditing({ ...editing, file_path: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Alt-Text</label>
                <Input value={editing.alt_text || ''} onChange={e => setEditing({ ...editing, alt_text: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Caption</label>
                <Input value={editing.caption || ''} onChange={e => setEditing({ ...editing, caption: e.target.value })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Keywords (kommagetrennt)</label>
                <Input value={(editing.keywords || []).join(', ')} onChange={e => setEditing({ ...editing, keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Lizenz</label>
                <Input value={editing.license || ''} onChange={e => setEditing({ ...editing, license: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Abbrechen</Button>
            <Button onClick={handleSave}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══ SEO Redirects Manager ═══
export function RedirectsManager() {
  const { data: redirects = [], isLoading } = useSEORedirects();
  const { create, update, remove } = useSEORedirectMutations();
  const [editing, setEditing] = useState<Partial<SEORedirect> | null>(null);

  const handleSave = () => {
    if (!editing) return;
    if (editing.id) { update.mutate(editing as SEORedirect & { id: string }); }
    else { create.mutate(editing); }
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setEditing({ from_path: '', to_path: '', status_code: 301, is_active: true })}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Neuer Redirect
        </Button>
        <Badge variant="outline" className="text-xs">{redirects.filter(r => r.is_active).length} aktiv</Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-3 px-4">Von</th>
                <th className="text-left py-3 px-4">Nach</th>
                <th className="text-left py-3 px-4 hidden md:table-cell">Code</th>
                <th className="text-right py-3 px-4">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">Laden…</td></tr>
              ) : redirects.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">Keine Redirects</td></tr>
              ) : redirects.map(r => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 px-4 font-mono text-xs">{r.from_path}</td>
                  <td className="py-2.5 px-4 font-mono text-xs flex items-center gap-1">
                    <ArrowRight className="h-3 w-3 text-muted-foreground" /> {r.to_path}
                  </td>
                  <td className="py-2.5 px-4 hidden md:table-cell"><Badge variant="outline" className="text-[10px]">{r.status_code}</Badge></td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(r)}><Edit className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => remove.mutate(r.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? 'Redirect bearbeiten' : 'Neuer Redirect'}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div><label className="text-xs font-medium text-muted-foreground">Von (Pfad)</label>
                <Input value={editing.from_path || ''} onChange={e => setEditing({ ...editing, from_path: e.target.value })} placeholder="/alter-pfad" /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Nach (Pfad)</label>
                <Input value={editing.to_path || ''} onChange={e => setEditing({ ...editing, to_path: e.target.value })} placeholder="/neuer-pfad" /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Status Code</label>
                <Select value={String(editing.status_code || 301)} onValueChange={v => setEditing({ ...editing, status_code: parseInt(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="301">301 (Permanent)</SelectItem>
                    <SelectItem value="302">302 (Temporär)</SelectItem>
                  </SelectContent>
                </Select></div>
              <div><label className="text-xs font-medium text-muted-foreground">Notizen</label>
                <Input value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Abbrechen</Button>
            <Button onClick={handleSave}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══ Content Layout (nested routing with Outlet) ═══
const CONTENT_TABS = [
  { path: '/admin/content', label: 'Seiten', icon: FileText, end: true },
  { path: '/admin/content/blog', label: 'Blog', icon: Edit },
  { path: '/admin/content/blocks', label: 'Content Blocks', icon: FileText },
  { path: '/admin/content/assets', label: 'Assets', icon: Image },
  { path: '/admin/content/media', label: 'Media & Alt', icon: Image },
  { path: '/admin/content/seo', label: 'SEO & Redirects', icon: Globe },
];

export function ContentLayout() {
  const location = useLocation();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Content & SEO</h1>
        <p className="text-sm text-muted-foreground mt-1">Seiten, Blog, Assets & SEO verwalten</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {CONTENT_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = tab.end
            ? location.pathname === tab.path
            : location.pathname.startsWith(tab.path);
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors -mb-px whitespace-nowrap min-h-[44px]",
                isActive
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {tab.label}
            </Link>
          );
        })}
      </div>

      <Outlet />
    </div>
  );
}

// Legacy export for backward compat
export const ContentPagesOverview = ContentLayout;
