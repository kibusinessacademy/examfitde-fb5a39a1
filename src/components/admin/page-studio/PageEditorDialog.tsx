import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, Save, Globe, GripVertical, Plus, Trash2, ChevronUp, ChevronDown, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { buildDefaultBlockContent, snapshotPageVersion, isSlugTaken, slugify } from '@/lib/page-studio-utils';
import { HeroBlockEditor, RichTextBlockEditor, ImageBlockEditor, CTABlockEditor, FAQBlockEditor, TrustBarBlockEditor } from './block-editors';

interface Props {
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PageBlock {
  id: string;
  block_key: string;
  block_type: string;
  sort_order: number;
  is_enabled: boolean;
  content_json: Record<string, any>;
  styles_json: Record<string, any>;
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  hero: '🎯 Hero',
  rich_text: '📝 Rich Text',
  image: '🖼️ Bild',
  cta: '🔘 CTA',
  faq: '❓ FAQ',
  trust_bar: '✅ Trust Bar',
  feature_list: '⭐ Feature-Liste',
  card_grid: '🃏 Karten-Grid',
  steps: '📋 Schritte',
  search: '🔍 Suche',
  article_header: '📰 Artikelkopf',
  related_articles: '🔗 Verwandte Artikel',
  table_of_contents: '📑 Inhaltsverzeichnis',
  spacer: '⬜ Spacer',
  video: '🎬 Video',
  testimonials: '💬 Testimonials',
};

const AVAILABLE_BLOCK_TYPES = [
  'hero', 'rich_text', 'image', 'cta', 'faq', 'trust_bar',
  'feature_list', 'card_grid', 'steps', 'spacer', 'video', 'testimonials',
];

/** Renders the correct typed editor for a block, or a generic fallback */
function renderBlockEditor(
  block: PageBlock,
  onContentChange: (content: Record<string, any>) => void,
) {
  switch (block.block_type) {
    case 'hero':
      return <HeroBlockEditor content={block.content_json} onChange={onContentChange} />;
    case 'rich_text':
      return <RichTextBlockEditor content={block.content_json} onChange={onContentChange} />;
    case 'image':
      return <ImageBlockEditor content={block.content_json} onChange={onContentChange as any} />;
    case 'cta':
      return <CTABlockEditor content={block.content_json} onChange={onContentChange} />;
    case 'faq':
      return <FAQBlockEditor content={block.content_json} onChange={onContentChange} />;
    case 'trust_bar':
      return <TrustBarBlockEditor content={block.content_json} onChange={onContentChange} />;
    default:
      return <GenericBlockEditor content={block.content_json} onChange={onContentChange} />;
  }
}

export function PageEditorDialog({ pageId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('blocks');
  const [slugError, setSlugError] = useState('');
  // Track local unsaved block changes
  const [dirtyBlocks, setDirtyBlocks] = useState<Record<string, Record<string, any>>>({});

  const { data: page, isLoading: pageLoading } = useQuery({
    queryKey: ['cms-page', pageId],
    enabled: !!pageId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('cms_pages')
        .select('*')
        .eq('id', pageId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: blocks = [], isLoading: blocksLoading } = useQuery({
    queryKey: ['cms-page-blocks', pageId],
    enabled: !!pageId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('cms_page_blocks')
        .select('*')
        .eq('page_id', pageId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PageBlock[];
    },
  });

  // Local form state
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [metaDesc, setMetaDesc] = useState('');
  const [ogTitle, setOgTitle] = useState('');
  const [ogDesc, setOgDesc] = useState('');
  const [ogImage, setOgImage] = useState('');
  const [canonical, setCanonical] = useState('');
  const [robots, setRobots] = useState('index,follow');

  useEffect(() => {
    if (!page) return;
    setTitle(page.title || '');
    setSlug(page.slug || '');
    setExcerpt(page.excerpt || '');
    setSeoTitle(page.seo_title || '');
    setMetaDesc(page.meta_description || '');
    setOgTitle(page.og_title || '');
    setOgDesc(page.og_description || '');
    setOgImage(page.og_image_url || '');
    setCanonical(page.canonical_url || '');
    setRobots(page.robots || 'index,follow');
    setSlugError('');
    setDirtyBlocks({});
  }, [page]);

  const invalidatePage = () => {
    queryClient.invalidateQueries({ queryKey: ['cms-pages'] });
    queryClient.invalidateQueries({ queryKey: ['cms-page', pageId] });
    queryClient.invalidateQueries({ queryKey: ['cms-page-blocks', pageId] });
  };

  // Save page metadata + dirty blocks + snapshot
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (slug !== page?.slug) {
        const taken = await isSlugTaken(slug.trim(), pageId);
        if (taken) throw new Error('Slug bereits vergeben.');
      }

      const { error } = await (supabase as any)
        .from('cms_pages')
        .update({
          title, slug: slug.trim(), excerpt,
          seo_title: seoTitle || null,
          meta_description: metaDesc || null,
          og_title: ogTitle || null,
          og_description: ogDesc || null,
          og_image_url: ogImage || null,
          canonical_url: canonical || null,
          robots,
        })
        .eq('id', pageId);
      if (error) {
        if (error.code === '23505') throw new Error('Slug bereits vergeben.');
        throw error;
      }

      // Save all dirty block contents
      for (const [blockId, content] of Object.entries(dirtyBlocks)) {
        await (supabase as any)
          .from('cms_page_blocks')
          .update({ content_json: content })
          .eq('id', blockId);
      }

      // Snapshot on save
      await snapshotPageVersion(pageId);
    },
    onSuccess: () => {
      setSlugError('');
      setDirtyBlocks({});
      invalidatePage();
      toast.success('Gespeichert');
    },
    onError: (err: any) => {
      if (err.message?.includes('Slug')) {
        setSlugError(err.message);
      } else {
        toast.error(err.message || 'Fehler beim Speichern');
      }
    },
  });

  // Publish (auto-snapshot via DB trigger)
  const publishMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from('cms_pages')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', pageId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidatePage();
      toast.success('Veröffentlicht');
    },
  });

  // Structural block mutations — these trigger snapshots
  const toggleBlock = useMutation({
    mutationFn: async ({ blockId, enabled }: { blockId: string; enabled: boolean }) => {
      const { error } = await (supabase as any)
        .from('cms_page_blocks')
        .update({ is_enabled: enabled })
        .eq('id', blockId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cms-page-blocks', pageId] }),
  });

  const moveBlock = useMutation({
    mutationFn: async ({ blockId, direction }: { blockId: string; direction: 'up' | 'down' }) => {
      const idx = blocks.findIndex((b) => b.id === blockId);
      if (idx < 0) return;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= blocks.length) return;

      const updates = [
        { id: blocks[idx].id, sort_order: blocks[swapIdx].sort_order },
        { id: blocks[swapIdx].id, sort_order: blocks[idx].sort_order },
      ];

      for (const u of updates) {
        await (supabase as any).from('cms_page_blocks').update({ sort_order: u.sort_order }).eq('id', u.id);
      }
      // Snapshot on structural change
      await snapshotPageVersion(pageId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cms-page-blocks', pageId] }),
  });

  const addBlock = useMutation({
    mutationFn: async (blockType: string) => {
      const maxOrder = blocks.length > 0 ? Math.max(...blocks.map((b) => b.sort_order)) + 1 : 0;
      const { error } = await (supabase as any)
        .from('cms_page_blocks')
        .insert({
          page_id: pageId,
          block_key: `${blockType}_${Date.now().toString(36)}`,
          block_type: blockType,
          sort_order: maxOrder,
          content_json: buildDefaultBlockContent(blockType),
        });
      if (error) throw error;
      await snapshotPageVersion(pageId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cms-page-blocks', pageId] });
      toast.success('Block hinzugefügt');
    },
  });

  const deleteBlock = useMutation({
    mutationFn: async (blockId: string) => {
      const { error } = await (supabase as any)
        .from('cms_page_blocks')
        .delete()
        .eq('id', blockId);
      if (error) throw error;
      await snapshotPageVersion(pageId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cms-page-blocks', pageId] });
      toast.success('Block entfernt');
    },
  });

  // Handle block content changes locally (no snapshot per keystroke)
  const handleBlockContentChange = (blockId: string, content: Record<string, any>) => {
    setDirtyBlocks((prev) => ({ ...prev, [blockId]: content }));
  };

  const hasDirtyBlocks = Object.keys(dirtyBlocks).length > 0;

  if (pageLoading || blocksLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base">{title || 'Seite bearbeiten'}</DialogTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">{page?.status}</Badge>
              {hasDirtyBlocks && (
                <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600">Ungespeichert</Badge>
              )}
              <Button variant="outline" size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Speichern
              </Button>
              {page?.status !== 'published' && (
                <Button size="sm" onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending}>
                  <Globe className="h-3.5 w-3.5 mr-1" />Veröffentlichen
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="blocks">Blöcke</TabsTrigger>
            <TabsTrigger value="general">Allgemein</TabsTrigger>
            <TabsTrigger value="seo">SEO</TabsTrigger>
          </TabsList>

          {/* Blocks Tab */}
          <TabsContent value="blocks" className="space-y-3 mt-4">
            {blocks.map((block, idx) => {
              const effectiveContent = dirtyBlocks[block.id] ?? block.content_json;
              const effectiveBlock = { ...block, content_json: effectiveContent };
              const isDirty = !!dirtyBlocks[block.id];

              return (
                <Card key={block.id} className={`p-3 ${!block.is_enabled ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium flex-1">
                      {BLOCK_TYPE_LABELS[block.block_type] || block.block_type}
                      {isDirty && <span className="text-amber-500 ml-1">●</span>}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0}
                        onClick={() => moveBlock.mutate({ blockId: block.id, direction: 'up' })}>
                        <ChevronUp className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === blocks.length - 1}
                        onClick={() => moveBlock.mutate({ blockId: block.id, direction: 'down' })}>
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                      <Switch
                        checked={block.is_enabled}
                        onCheckedChange={(checked) => toggleBlock.mutate({ blockId: block.id, enabled: checked })}
                      />
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                        onClick={() => deleteBlock.mutate(block.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  {renderBlockEditor(effectiveBlock, (content) => handleBlockContentChange(block.id, content))}
                </Card>
              );
            })}

            {/* Add Block */}
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-2">Block hinzufügen:</p>
              <div className="flex flex-wrap gap-1.5">
                {AVAILABLE_BLOCK_TYPES.map((type) => (
                  <Button key={type} variant="outline" size="sm" className="text-xs h-7"
                    onClick={() => addBlock.mutate(type)}>
                    <Plus className="h-3 w-3 mr-1" />
                    {BLOCK_TYPE_LABELS[type] || type}
                  </Button>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Titel</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Slug</Label>
                <Input
                  value={slug}
                  onChange={(e) => { setSlug(slugify(e.target.value)); setSlugError(''); }}
                  className={slugError ? 'border-destructive' : ''}
                />
                {slugError && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />{slugError}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Excerpt / Beschreibung</Label>
                <Textarea value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={3} />
              </div>
            </div>
          </TabsContent>

          {/* SEO Tab */}
          <TabsContent value="seo" className="space-y-4 mt-4">
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">SEO Title</Label>
                <Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder={title} />
                <p className="text-[10px] text-muted-foreground">{(seoTitle || title).length}/60 Zeichen</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Meta Description</Label>
                <Textarea value={metaDesc} onChange={(e) => setMetaDesc(e.target.value)} rows={2} />
                <p className="text-[10px] text-muted-foreground">{metaDesc.length}/160 Zeichen</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Canonical URL</Label>
                <Input value={canonical} onChange={(e) => setCanonical(e.target.value)} placeholder="https://examfit.de/..." />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Robots</Label>
                <Input value={robots} onChange={(e) => setRobots(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">OG Title</Label>
                <Input value={ogTitle} onChange={(e) => setOgTitle(e.target.value)} placeholder={seoTitle || title} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">OG Description</Label>
                <Textarea value={ogDesc} onChange={(e) => setOgDesc(e.target.value)} rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">OG Bild URL</Label>
                <Input value={ogImage} onChange={(e) => setOgImage(e.target.value)} placeholder="https://..." />
              </div>

              {/* SEO Preview */}
              <Card className="p-3 bg-muted/30">
                <p className="text-[10px] text-muted-foreground mb-1">Google-Vorschau</p>
                <p className="text-sm font-medium truncate text-primary">{seoTitle || title || 'Seitentitel'}</p>
                <p className="text-xs truncate text-muted-foreground">{canonical || `examfit.de/${slug}`}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{metaDesc || 'Meta-Beschreibung…'}</p>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** Generic fallback editor for block types without a dedicated editor */
function GenericBlockEditor({ content, onChange }: { content: Record<string, any>; onChange: (c: Record<string, any>) => void }) {
  const fields = Object.keys(content);
  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Leerer Block</p>;
  }

  return (
    <div className="space-y-2">
      {fields.map((key) => {
        const val = content[key];
        if (Array.isArray(val)) {
          return (
            <div key={key} className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">{key}</Label>
              <p className="text-[10px] text-muted-foreground italic">{val.length} Einträge</p>
            </div>
          );
        }
        if (typeof val === 'boolean') {
          return (
            <div key={key} className="flex items-center gap-2">
              <Switch checked={val} onCheckedChange={(v) => onChange({ ...content, [key]: v })} />
              <Label className="text-[10px] text-muted-foreground">{key}</Label>
            </div>
          );
        }
        if (typeof val === 'string') {
          return (
            <div key={key} className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">{key}</Label>
              {val.length > 80 ? (
                <Textarea value={val} onChange={(e) => onChange({ ...content, [key]: e.target.value })} rows={2} className="text-xs" />
              ) : (
                <Input value={val} onChange={(e) => onChange({ ...content, [key]: e.target.value })} className="text-xs h-8" />
              )}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
