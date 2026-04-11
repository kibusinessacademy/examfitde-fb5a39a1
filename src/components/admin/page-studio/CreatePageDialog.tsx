import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { slugify, buildDefaultBlockContent, isSlugTaken } from '@/lib/page-studio-utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CmsTemplate {
  id: string;
  template_key: string;
  name: string;
  description: string | null;
  page_type: string;
  default_blocks_json: any[];
}

const PAGE_TYPES = [
  { value: 'marketing_page', label: 'Marketing-Seite' },
  { value: 'landing_page', label: 'Landingpage' },
  { value: 'blog_article', label: 'Blogartikel' },
  { value: 'faq_page', label: 'FAQ-Seite' },
  { value: 'legal_page', label: 'Rechtliche Seite' },
];

export function CreatePageDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'type' | 'template' | 'details'>('type');
  const [pageType, setPageType] = useState('marketing_page');
  const [selectedTemplate, setSelectedTemplate] = useState<CmsTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugError, setSlugError] = useState('');

  const { data: templates = [] } = useQuery({
    queryKey: ['cms-templates'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('cms_templates')
        .select('*')
        .eq('is_active', true);
      if (error) throw error;
      return (data ?? []) as CmsTemplate[];
    },
  });

  const filteredTemplates = templates.filter((t) => t.page_type === pageType);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate || !title.trim() || !slug.trim()) throw new Error('Fehlende Daten');

      // Check slug uniqueness
      const taken = await isSlugTaken(slug.trim());
      if (taken) {
        throw new Error('Dieser Slug ist bereits vergeben. Bitte wähle einen anderen.');
      }

      // Create page
      const { data: page, error } = await (supabase as any)
        .from('cms_pages')
        .insert({
          slug: slug.trim(),
          title: title.trim(),
          page_type: pageType,
          template_key: selectedTemplate.template_key,
          status: 'draft',
        })
        .select('id')
        .single();
      if (error) {
        if (error.code === '23505') throw new Error('Slug bereits vergeben.');
        throw error;
      }

      // Create default blocks from template with typed defaults
      const blocks = (selectedTemplate.default_blocks_json || []).map((b: any, i: number) => ({
        page_id: page.id,
        block_key: b.block_key || `block_${i}`,
        block_type: b.block_type || 'rich_text',
        sort_order: b.sort_order ?? i,
        is_enabled: true,
        content_json: b.content_json && Object.keys(b.content_json).length > 0
          ? b.content_json
          : buildDefaultBlockContent(b.block_type || 'rich_text'),
        styles_json: b.styles_json || {},
      }));

      if (blocks.length > 0) {
        const { error: blockError } = await (supabase as any)
          .from('cms_page_blocks')
          .insert(blocks);
        if (blockError) throw blockError;
      }

      return page;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cms-pages'] });
      toast.success('Seite erstellt');
      resetAndClose();
    },
    onError: (err: any) => {
      if (err.message?.includes('Slug')) {
        setSlugError(err.message);
      } else {
        toast.error(err.message || 'Fehler beim Erstellen');
      }
    },
  });

  const resetAndClose = () => {
    setStep('type');
    setPageType('marketing_page');
    setSelectedTemplate(null);
    setTitle('');
    setSlug('');
    setSlugTouched(false);
    setSlugError('');
    onOpenChange(false);
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slugTouched) {
      setSlug(slugify(val));
      setSlugError('');
    }
  };

  const handleSlugChange = (val: string) => {
    setSlug(slugify(val));
    setSlugTouched(true);
    setSlugError('');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetAndClose(); else onOpenChange(true); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === 'type' && 'Seitentyp wählen'}
            {step === 'template' && 'Template wählen'}
            {step === 'details' && 'Seite anlegen'}
          </DialogTitle>
        </DialogHeader>

        {step === 'type' && (
          <div className="space-y-2">
            {PAGE_TYPES.map((pt) => (
              <Card
                key={pt.value}
                className={`p-3 cursor-pointer transition-colors ${pageType === pt.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'}`}
                onClick={() => setPageType(pt.value)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{pt.label}</span>
                  {pageType === pt.value && <Check className="h-4 w-4 text-primary" />}
                </div>
              </Card>
            ))}
            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={() => setStep('template')}>Weiter</Button>
            </div>
          </div>
        )}

        {step === 'template' && (
          <div className="space-y-2">
            {filteredTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Keine Templates für diesen Typ verfügbar
              </p>
            ) : (
              filteredTemplates.map((t) => (
                <Card
                  key={t.id}
                  className={`p-3 cursor-pointer transition-colors ${selectedTemplate?.id === t.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'}`}
                  onClick={() => setSelectedTemplate(t)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-sm">{t.name}</span>
                      {t.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px]">
                        {(t.default_blocks_json || []).length} Blöcke
                      </Badge>
                      {selectedTemplate?.id === t.id && <Check className="h-4 w-4 text-primary" />}
                    </div>
                  </div>
                </Card>
              ))
            )}
            <div className="flex justify-between pt-2">
              <Button variant="outline" size="sm" onClick={() => setStep('type')}>Zurück</Button>
              <Button size="sm" onClick={() => setStep('details')} disabled={!selectedTemplate}>
                Weiter
              </Button>
            </div>
          </div>
        )}

        {step === 'details' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Titel</Label>
              <Input
                placeholder="z. B. Für Azubis"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Slug (URL)</Label>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <span>examfit.de/</span>
                <span className="font-mono">{slug || '…'}</span>
              </div>
              <Input
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                className={slugError ? 'border-destructive' : ''}
              />
              {slugError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />{slugError}
                </p>
              )}
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="outline" size="sm" onClick={() => setStep('template')}>Zurück</Button>
              <Button
                size="sm"
                onClick={() => createMutation.mutate()}
                disabled={!title.trim() || !slug.trim() || createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Seite erstellen
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
