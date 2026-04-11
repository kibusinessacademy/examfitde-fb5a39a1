import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Search, FileText, ShoppingBag, Globe, Filter, MoreHorizontal, Eye, Copy, Archive, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { CreatePageDialog } from '@/components/admin/page-studio/CreatePageDialog';
import { PageEditorDialog } from '@/components/admin/page-studio/PageEditorDialog';
import { resolvePagePreviewUrl, snapshotPageVersion } from '@/lib/page-studio-utils';

interface CmsPage {
  id: string;
  slug: string;
  title: string;
  page_type: string;
  template_key: string;
  status: string;
  is_system_page: boolean;
  published_at: string | null;
  updated_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  marketing_page: 'Seite',
  landing_page: 'Landingpage',
  blog_article: 'Blog',
  faq_page: 'FAQ',
  legal_page: 'Rechtlich',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/15 text-yellow-700 border-yellow-500/30',
  review: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  published: 'bg-green-500/15 text-green-700 border-green-500/30',
  archived: 'bg-muted text-muted-foreground border-border',
};

export default function PageStudioPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);

  const { data: pages = [], isLoading } = useQuery({
    queryKey: ['cms-pages'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('cms_pages')
        .select('id, slug, title, page_type, template_key, status, is_system_page, published_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CmsPage[];
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (page: CmsPage) => {
      // Get full page with blocks
      const { data: blocks } = await (supabase as any)
        .from('cms_page_blocks')
        .select('block_key, block_type, sort_order, is_enabled, content_json, styles_json')
        .eq('page_id', page.id);

      const newSlug = `${page.slug}-kopie-${Date.now().toString(36)}`;
      const { data: newPage, error } = await (supabase as any)
        .from('cms_pages')
        .insert({
          slug: newSlug,
          title: `${page.title} (Kopie)`,
          page_type: page.page_type,
          template_key: page.template_key,
          status: 'draft',
        })
        .select('id')
        .single();
      if (error) throw error;

      if (blocks?.length) {
        await (supabase as any)
          .from('cms_page_blocks')
          .insert(blocks.map((b: any) => ({ ...b, page_id: newPage.id })));
      }
      return newPage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cms-pages'] });
      toast.success('Seite dupliziert');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('cms_pages')
        .update({ status: 'archived' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cms-pages'] });
      toast.success('Seite archiviert');
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('cms_pages')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cms-pages'] });
      toast.success('Seite veröffentlicht');
    },
  });

  // Snapshot on manual save from list
  const snapshotMutation = useMutation({
    mutationFn: async (id: string) => {
      await snapshotPageVersion(id);
    },
  });

  const filtered = useMemo(() => {
    return pages.filter((p) => {
      if (typeFilter !== 'all' && p.page_type !== typeFilter) return false;
      if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.slug.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [pages, typeFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: pages.length };
    for (const p of pages) {
      c[p.page_type] = (c[p.page_type] || 0) + 1;
    }
    return c;
  }, [pages]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Page Studio</h1>
          <p className="text-sm text-muted-foreground">Seiten, Landingpages & Blogartikel verwalten</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Neue Seite
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Seiten durchsuchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Tabs value={typeFilter} onValueChange={setTypeFilter}>
          <TabsList className="h-9">
            <TabsTrigger value="all" className="text-xs">Alle ({counts.all || 0})</TabsTrigger>
            <TabsTrigger value="marketing_page" className="text-xs">Seiten ({counts.marketing_page || 0})</TabsTrigger>
            <TabsTrigger value="landing_page" className="text-xs">Landing ({counts.landing_page || 0})</TabsTrigger>
            <TabsTrigger value="blog_article" className="text-xs">Blog ({counts.blog_article || 0})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Pages List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Laden…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">Noch keine Seiten vorhanden</p>
          <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Erste Seite erstellen
          </Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((page) => (
            <Card
              key={page.id}
              className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => setEditingPageId(page.id)}
            >
              <div className="shrink-0">
                {page.page_type === 'blog_article' ? (
                  <FileText className="h-5 w-5 text-muted-foreground" />
                ) : page.page_type === 'landing_page' ? (
                  <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <Globe className="h-5 w-5 text-muted-foreground" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{page.title}</span>
                  {page.is_system_page && (
                    <Badge variant="outline" className="text-[9px] shrink-0">System</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  /{page.slug} · {TYPE_LABELS[page.page_type] || page.page_type} · {page.template_key}
                </div>
              </div>

              <Badge variant="outline" className={`text-[10px] shrink-0 ${STATUS_COLORS[page.status] || ''}`}>
                {page.status}
              </Badge>

              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => setEditingPageId(page.id)}>
                    <Eye className="h-4 w-4 mr-2" />Bearbeiten
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.open(`/${page.slug}`, '_blank')}>
                    <ExternalLink className="h-4 w-4 mr-2" />Vorschau
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => duplicateMutation.mutate(page)}>
                    <Copy className="h-4 w-4 mr-2" />Duplizieren
                  </DropdownMenuItem>
                  {page.status === 'draft' && (
                    <DropdownMenuItem onClick={() => publishMutation.mutate(page.id)}>
                      <Globe className="h-4 w-4 mr-2" />Veröffentlichen
                    </DropdownMenuItem>
                  )}
                  {page.status !== 'archived' && (
                    <DropdownMenuItem onClick={() => archiveMutation.mutate(page.id)} className="text-destructive">
                      <Archive className="h-4 w-4 mr-2" />Archivieren
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </Card>
          ))}
        </div>
      )}

      <CreatePageDialog open={createOpen} onOpenChange={setCreateOpen} />
      {editingPageId && (
        <PageEditorDialog
          pageId={editingPageId}
          open={!!editingPageId}
          onOpenChange={(open) => { if (!open) setEditingPageId(null); }}
        />
      )}
    </div>
  );
}
