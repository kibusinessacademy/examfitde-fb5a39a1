import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Copy, Check, Music, Video, Linkedin, Instagram, Mail, FileText, Layers, Trash2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

type PlatformVariant =
  | 'suno' | 'tasy_generic'
  | 'linkedin_pro_b2b' | 'linkedin_pro_learner' | 'linkedin_post'
  | 'facebook_post' | 'xing_post'
  | 'instagram_post_azubi' | 'instagram_post_ausbildungsleiter'
  | 'instagram_reel_azubi' | 'instagram_reel_ausbildungsleiter' | 'instagram_carousel'
  | 'email_b2b' | 'email_learner'
  | 'blog_seo' | 'carousel_linkedin' | 'thought_leadership' | 'kpi_video';

type Intent = 'prüfungsfalle' | 'merksatz' | 'minicheck' | 'usp_examfit';

interface ContentItem {
  id: string;
  created_at: string;
  provider: string;
  platform_variant: string;
  intent: string | null;
  audience: string | null;
  title: string | null;
  payload: Record<string, unknown>;
}

const INTENT_OPTIONS: { value: Intent; label: string }[] = [
  { value: 'prüfungsfalle', label: 'Prüfungsfalle' },
  { value: 'merksatz', label: 'Merksatz' },
  { value: 'minicheck', label: 'Mini-Check' },
  { value: 'usp_examfit', label: 'USP ExamFit' },
];

async function invokeEngine(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Nicht eingeloggt');

  const res = await supabase.functions.invoke('admin-social-engine', {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (res.error) throw new Error(res.error.message || 'Fehler');
  return res.data;
}

// ── Copy Button ──
function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
      {label}
    </Button>
  );
}

// ── Content Card ──
function ContentCard({ item, onDelete }: { item: ContentItem; onDelete: (id: string) => void }) {
  const p = item.payload;
  const providerIcons: Record<string, typeof Music> = {
    suno: Music, tasy: Video, linkedin: Linkedin, instagram: Instagram,
    email: Mail, blog: FileText, carousel: Layers,
  };
  const Icon = providerIcons[item.provider] || FileText;

  // Build copy options based on provider
  const copyOptions: { key: string; label: string; value: string }[] = [];
  if (item.provider === 'suno') {
    if (p.lyrics) copyOptions.push({ key: 'lyrics', label: 'Lyrics', value: p.lyrics as string });
    if (p.style_prompt) copyOptions.push({ key: 'style', label: 'Style', value: p.style_prompt as string });
  } else if (item.provider === 'tasy') {
    if (p.brief) copyOptions.push({ key: 'brief', label: 'Brief', value: p.brief as string });
    if (p.script) copyOptions.push({ key: 'script', label: 'Skript', value: p.script as string });
  } else if (['linkedin', 'facebook', 'xing'].includes(item.provider)) {
    if (p.text) copyOptions.push({ key: 'text', label: 'Text', value: p.text as string });
    if (p.hashtags) copyOptions.push({ key: 'hashtags', label: 'Hashtags', value: (p.hashtags as string[]).join(' ') });
  } else if (item.provider === 'instagram') {
    if (p.caption) copyOptions.push({ key: 'caption', label: 'Caption', value: p.caption as string });
    if (p.hashtags) copyOptions.push({ key: 'hashtags', label: 'Hashtags', value: (p.hashtags as string[]).join(' ') });
  } else if (item.provider === 'email') {
    if (p.subject) copyOptions.push({ key: 'subject', label: 'Betreff', value: p.subject as string });
    if (p.body) copyOptions.push({ key: 'body', label: 'Body', value: p.body as string });
  } else if (item.provider === 'blog') {
    if (p.title) copyOptions.push({ key: 'title', label: 'Titel', value: p.title as string });
    if (p.body_markdown) copyOptions.push({ key: 'body', label: 'Artikel', value: p.body_markdown as string });
  }
  // Always add "Alles"
  copyOptions.push({ key: 'all', label: 'Alles', value: JSON.stringify(p, null, 2) });

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">{item.title || item.platform_variant}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            {item.intent && <Badge variant="secondary" className="text-xs">{item.intent}</Badge>}
            <Badge variant="outline" className="text-xs">{item.platform_variant}</Badge>
          </div>
        </div>
        <CardDescription className="text-xs">
          {new Date(item.created_at).toLocaleString('de-DE')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-auto max-h-48 whitespace-pre-wrap">
          {JSON.stringify(p, null, 2)}
        </pre>
        <div className="flex flex-wrap gap-1 mt-3">
          {copyOptions.map(o => (
            <CopyBtn key={o.key} text={o.value} label={o.label} />
          ))}
          <Button variant="ghost" size="sm" className="text-destructive ml-auto" onClick={() => onDelete(item.id)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Generator Panel ──
function GeneratorPanel({ defaultVariant, variants }: { defaultVariant: PlatformVariant; variants: { value: PlatformVariant; label: string }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [variant, setVariant] = useState<PlatformVariant>(defaultVariant);
  const [intent, setIntent] = useState<Intent | ''>('');
  const [topic, setTopic] = useState('');
  const [context, setContext] = useState('');
  const [audience, setAudience] = useState('');

  const generate = useMutation({
    mutationFn: () => invokeEngine({
      action: 'generate',
      platform_variant: variant,
      intent: intent || undefined,
      topic, context, audience,
    }),
    onSuccess: () => {
      toast({ title: 'Content erstellt' });
      qc.invalidateQueries({ queryKey: ['social-content'] });
    },
    onError: (e) => toast({ title: 'Fehler', description: e.message, variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Neuen Content generieren</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select value={variant} onValueChange={(v) => setVariant(v as PlatformVariant)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {variants.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={intent} onValueChange={(v) => setIntent(v as Intent)}>
            <SelectTrigger><SelectValue placeholder="Intent (optional)" /></SelectTrigger>
            <SelectContent>
              {INTENT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Input placeholder="Thema" value={topic} onChange={e => setTopic(e.target.value)} />
        <Input placeholder="Zielgruppe (optional)" value={audience} onChange={e => setAudience(e.target.value)} />
        <Textarea placeholder="Kontext (optional)" value={context} onChange={e => setContext(e.target.value)} rows={2} />
        <Button onClick={() => generate.mutate()} disabled={generate.isPending} className="w-full">
          {generate.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generiere…</> : 'Generieren'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Content List ──
function ContentList({ provider }: { provider?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['social-content', provider],
    queryFn: async () => {
      const res = await invokeEngine({ action: 'list', provider, limit: 50 });
      return (res.items || []) as ContentItem[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => invokeEngine({ action: 'delete', id }),
    onSuccess: () => {
      toast({ title: 'Gelöscht' });
      qc.invalidateQueries({ queryKey: ['social-content'] });
    },
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const items = data || [];
  if (!items.length) return <p className="text-sm text-muted-foreground py-4">Noch keine Inhalte.</p>;

  return (
    <div className="space-y-3">
      {items.map(item => (
        <ContentCard key={item.id} item={item} onDelete={(id) => deleteMut.mutate(id)} />
      ))}
    </div>
  );
}

// ── Level 2 Panel ──
function Level2Panel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [topic, setTopic] = useState('');
  const [seqName, setSeqName] = useState('');

  const bundle = useMutation({
    mutationFn: () => invokeEngine({ action: 'generate_bundle', topic }),
    onSuccess: () => {
      toast({ title: 'Bundle erstellt (5 Plattformen)' });
      qc.invalidateQueries({ queryKey: ['social-content'] });
    },
    onError: (e) => toast({ title: 'Fehler', description: e.message, variant: 'destructive' }),
  });

  const planWeek = useMutation({
    mutationFn: () => invokeEngine({ action: 'plan_week', topic }),
    onSuccess: () => {
      toast({ title: 'Wochenplan erstellt' });
      qc.invalidateQueries({ queryKey: ['social-content'] });
    },
    onError: (e) => toast({ title: 'Fehler', description: e.message, variant: 'destructive' }),
  });

  const sequence = useMutation({
    mutationFn: () => invokeEngine({ action: 'sequence_generate', sequence_name: seqName || 'Neue Sequenz', topic }),
    onSuccess: () => {
      toast({ title: 'Nurture-Sequenz erstellt' });
    },
    onError: (e) => toast({ title: 'Fehler', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Multi-Plattform Bundle</CardTitle>
          <CardDescription>Generiert Content für LinkedIn, Facebook, Instagram, E-Mail & Blog auf einmal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Thema" value={topic} onChange={e => setTopic(e.target.value)} />
          <div className="flex gap-2">
            <Button onClick={() => bundle.mutate()} disabled={bundle.isPending} className="flex-1">
              {bundle.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Layers className="h-4 w-4 mr-2" />}
              Bundle generieren
            </Button>
            <Button variant="outline" onClick={() => planWeek.mutate()} disabled={planWeek.isPending}>
              {planWeek.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Wochenplan
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nurture-Sequenz</CardTitle>
          <CardDescription>Erstellt eine automatisierte E-Mail-Sequenz (5 Steps).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Sequenz-Name" value={seqName} onChange={e => setSeqName(e.target.value)} />
          <Button onClick={() => sequence.mutate()} disabled={sequence.isPending} className="w-full">
            {sequence.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
            Sequenz generieren
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ──
export default function SocialEnginePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Social Engine</h1>
        <p className="text-muted-foreground text-sm">KI-gestützte Content-Erstellung für alle Plattformen.</p>
      </div>

      <Tabs defaultValue="scripts" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="scripts" className="gap-1"><Music className="h-3.5 w-3.5" /> Skripte</TabsTrigger>
          <TabsTrigger value="posts" className="gap-1"><Linkedin className="h-3.5 w-3.5" /> Posts</TabsTrigger>
          <TabsTrigger value="instagram" className="gap-1"><Instagram className="h-3.5 w-3.5" /> Instagram</TabsTrigger>
          <TabsTrigger value="email" className="gap-1"><Mail className="h-3.5 w-3.5" /> E-Mail</TabsTrigger>
          <TabsTrigger value="blog" className="gap-1"><FileText className="h-3.5 w-3.5" /> Blog</TabsTrigger>
          <TabsTrigger value="level2" className="gap-1"><Layers className="h-3.5 w-3.5" /> Level 2</TabsTrigger>
          <TabsTrigger value="library" className="gap-1"><RefreshCw className="h-3.5 w-3.5" /> Bibliothek</TabsTrigger>
        </TabsList>

        <TabsContent value="scripts" className="space-y-4 mt-4">
          <GeneratorPanel
            defaultVariant="suno"
            variants={[
              { value: 'suno', label: 'Suno (Song)' },
              { value: 'tasy_generic', label: 'Tasy (Video-Skript)' },
            ]}
          />
          <ContentList provider="suno" />
          <ContentList provider="tasy" />
        </TabsContent>

        <TabsContent value="posts" className="space-y-4 mt-4">
          <GeneratorPanel
            defaultVariant="linkedin_post"
            variants={[
              { value: 'linkedin_post', label: 'LinkedIn Post' },
              { value: 'linkedin_pro_b2b', label: 'LinkedIn Pro (B2B)' },
              { value: 'linkedin_pro_learner', label: 'LinkedIn Pro (Learner)' },
              { value: 'facebook_post', label: 'Facebook Post' },
              { value: 'xing_post', label: 'XING Post' },
              { value: 'thought_leadership', label: 'Thought Leadership' },
              { value: 'carousel_linkedin', label: 'LinkedIn Carousel' },
            ]}
          />
          <ContentList provider="linkedin" />
          <ContentList provider="facebook" />
          <ContentList provider="xing" />
        </TabsContent>

        <TabsContent value="instagram" className="space-y-4 mt-4">
          <GeneratorPanel
            defaultVariant="instagram_post_azubi"
            variants={[
              { value: 'instagram_post_azubi', label: 'Post (Azubi)' },
              { value: 'instagram_post_ausbildungsleiter', label: 'Post (Ausbildungsleiter)' },
              { value: 'instagram_reel_azubi', label: 'Reel (Azubi)' },
              { value: 'instagram_reel_ausbildungsleiter', label: 'Reel (Ausbildungsleiter)' },
              { value: 'instagram_carousel', label: 'Carousel' },
            ]}
          />
          <ContentList provider="instagram" />
        </TabsContent>

        <TabsContent value="email" className="space-y-4 mt-4">
          <GeneratorPanel
            defaultVariant="email_b2b"
            variants={[
              { value: 'email_b2b', label: 'E-Mail (B2B)' },
              { value: 'email_learner', label: 'E-Mail (Learner)' },
            ]}
          />
          <ContentList provider="email" />
        </TabsContent>

        <TabsContent value="blog" className="space-y-4 mt-4">
          <GeneratorPanel
            defaultVariant="blog_seo"
            variants={[{ value: 'blog_seo', label: 'SEO Blog-Artikel' }]}
          />
          <ContentList provider="blog" />
        </TabsContent>

        <TabsContent value="level2" className="space-y-4 mt-4">
          <Level2Panel />
        </TabsContent>

        <TabsContent value="library" className="space-y-4 mt-4">
          <h2 className="text-lg font-semibold">Alle Inhalte</h2>
          <ContentList />
        </TabsContent>
      </Tabs>
    </div>
  );
}
