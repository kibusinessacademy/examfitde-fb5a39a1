import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, ExternalLink, Loader2, Apple, Smartphone, Copy, CheckCircle2, ChevronDown, ChevronUp, Sparkles, Shield, Package } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const CURRENT_YEAR = new Date().getFullYear();
const COPYRIGHT_TEXT = `© ${CURRENT_YEAR} ExamFit – Alle Rechte vorbehalten.`;

type StoreListing = {
  app_name?: string;
  subtitle?: string;
  short_description?: string;
  long_description?: string;
  keywords?: string;
  category?: string;
  content_rating?: string;
  whats_new?: string;
  privacy_policy_points?: string[];
  screenshot_texts?: string[];
  dsa_info?: string;
  technical_requirements?: { min_os_version?: string; devices?: string; permissions?: string[] };
  checklist?: string[];
  aso_tips?: string[];
  copyright_notice?: string;
  legal_footer?: string;
};

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost" size="sm"
      className="h-7 gap-1 text-xs"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); toast.success(`${label || 'Text'} kopiert`); setTimeout(() => setCopied(false), 2000); }}
    >
      {copied ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Kopiert' : 'Kopieren'}
    </Button>
  );
}

function StoreListingPanel({ listing, store }: { listing: StoreListing; store: 'apple' | 'google' }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (key: string) => setExpanded(prev => prev === key ? null : key);

  const allText = [
    listing.app_name && `APP NAME: ${listing.app_name}`,
    listing.subtitle && `SUBTITLE: ${listing.subtitle}`,
    listing.short_description && `SHORT: ${listing.short_description}`,
    listing.long_description && `DESCRIPTION:\n${listing.long_description}`,
    listing.keywords && `KEYWORDS: ${listing.keywords}`,
    listing.whats_new && `WHAT'S NEW:\n${listing.whats_new}`,
    listing.privacy_policy_points?.length && `PRIVACY:\n${listing.privacy_policy_points.join('\n')}`,
    listing.checklist?.length && `CHECKLIST:\n${listing.checklist.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
  ].filter(Boolean).join('\n\n');

  const sections = [
    { key: 'meta', title: 'App-Metadaten', content: (
      <div className="space-y-2 text-xs">
        {listing.app_name && <div className="flex justify-between items-center"><div><span className="text-muted-foreground">Name:</span> <strong>{listing.app_name}</strong></div><CopyButton text={listing.app_name} label="App-Name" /></div>}
        {listing.subtitle && <div className="flex justify-between items-center"><div><span className="text-muted-foreground">Untertitel:</span> {listing.subtitle}</div><CopyButton text={listing.subtitle} label="Subtitle" /></div>}
        {listing.category && <div><span className="text-muted-foreground">Kategorie:</span> {listing.category}</div>}
        {listing.content_rating && <div><span className="text-muted-foreground">Altersfreigabe:</span> {listing.content_rating}</div>}
        {listing.keywords && <div className="flex justify-between items-start gap-2"><div><span className="text-muted-foreground">Keywords:</span> <span className="text-[11px]">{listing.keywords}</span></div><CopyButton text={listing.keywords} label="Keywords" /></div>}
      </div>
    )},
    { key: 'desc', title: 'Beschreibung (ASO-optimiert)', content: (
      <div className="space-y-2">
        {listing.short_description && store === 'google' && (
          <div className="flex justify-between items-start gap-2">
            <p className="text-xs text-muted-foreground">{listing.short_description}</p>
            <CopyButton text={listing.short_description} label="Kurzbeschreibung" />
          </div>
        )}
        {listing.long_description && (
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-medium">Vollständige Beschreibung</span>
              <CopyButton text={listing.long_description} label="Beschreibung" />
            </div>
            <pre className="text-[11px] whitespace-pre-wrap bg-background/50 rounded p-2 max-h-60 overflow-y-auto border border-border/30">{listing.long_description}</pre>
          </div>
        )}
      </div>
    )},
    { key: 'screenshots', title: 'Screenshot-Texte', content: listing.screenshot_texts?.length ? (
      <div className="space-y-1">
        {listing.screenshot_texts.map((t, i) => (
          <div key={i} className="flex justify-between items-center text-xs bg-background/50 rounded p-1.5">
            <span><span className="text-muted-foreground mr-1">#{i + 1}</span> {t}</span>
            <CopyButton text={t} label={`Screenshot ${i + 1}`} />
          </div>
        ))}
      </div>
    ) : null },
    { key: 'privacy', title: 'Datenschutz & Compliance', content: (
      <div className="space-y-2 text-xs">
        {listing.privacy_policy_points?.map((p, i) => <div key={i} className="flex gap-2"><span className="text-muted-foreground shrink-0">•</span><span>{p}</span></div>)}
        {listing.dsa_info && <div className="mt-2 p-2 bg-background/50 rounded border border-border/30"><span className="text-muted-foreground block mb-1">DSA-Info:</span>{listing.dsa_info}<CopyButton text={listing.dsa_info} label="DSA" /></div>}
      </div>
    )},
    { key: 'tech', title: 'Technische Voraussetzungen', content: listing.technical_requirements ? (
      <div className="space-y-1 text-xs">
        {listing.technical_requirements.min_os_version && <div><span className="text-muted-foreground">Min. OS:</span> {listing.technical_requirements.min_os_version}</div>}
        {listing.technical_requirements.devices && <div><span className="text-muted-foreground">Geräte:</span> {listing.technical_requirements.devices}</div>}
        {listing.technical_requirements.permissions?.map((p, i) => <div key={i} className="flex gap-2"><span className="text-muted-foreground">•</span>{p}</div>)}
      </div>
    ) : null },
    { key: 'checklist', title: `Veröffentlichungs-Checkliste (${store === 'apple' ? 'App Store' : 'Play Store'})`, content: listing.checklist?.length ? (
      <div className="space-y-1">
        {listing.checklist.map((c, i) => (
          <div key={i} className="flex gap-2 text-xs items-start">
            <span className="text-muted-foreground font-mono shrink-0 w-5 text-right">{i + 1}.</span>
            <span>{c}</span>
          </div>
        ))}
      </div>
    ) : null },
    { key: 'aso', title: 'ASO-Tipps', content: listing.aso_tips?.length ? (
      <div className="space-y-1">
        {listing.aso_tips.map((t, i) => (
          <div key={i} className="flex gap-2 text-xs items-start">
            <Sparkles className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
            <span>{t}</span>
          </div>
        ))}
      </div>
    ) : null },
    { key: 'release', title: 'Release Notes', content: listing.whats_new ? (
      <div className="flex justify-between items-start gap-2">
        <pre className="text-xs whitespace-pre-wrap">{listing.whats_new}</pre>
        <CopyButton text={listing.whats_new} label="Release Notes" />
      </div>
    ) : null },
  ].filter(s => s.content);

  return (
    <div className="space-y-2 mt-3">
      <div className="flex justify-end">
        <CopyButton text={allText} label="Gesamtes Listing" />
      </div>
      {sections.map(s => (
        <div key={s.key} className="border border-border/30 rounded-lg overflow-hidden">
          <button
            className="w-full flex justify-between items-center px-3 py-2 text-xs font-medium hover:bg-muted/30 transition-colors"
            onClick={() => toggle(s.key)}
          >
            {s.title}
            {expanded === s.key ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {expanded === s.key && <div className="px-3 pb-3">{s.content}</div>}
        </div>
      ))}
    </div>
  );
}

export default function ExportTab({ pkg, packageId }: { pkg: any; packageId: string }) {
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [jsxExportUrl, setJsxExportUrl] = useState<string | null>(null);
  const [jsxExporting, setJsxExporting] = useState(false);

  // Store listing states
  const [appleListing, setAppleListing] = useState<StoreListing | null>(null);
  const [appleLoading, setAppleLoading] = useState(false);
  const [googleListing, setGoogleListing] = useState<StoreListing | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('export-course-package', {
        body: { packageId, courseId: pkg.course_id },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.error) throw res.error;
      const resData = res.data as Record<string, unknown>;
      if (resData?.downloadUrl) { setExportUrl(resData.downloadUrl as string); toast.success('ZIP-Export erstellt'); }
    } catch (e: any) { toast.error(`Export-Fehler: ${e?.message || 'Unbekannt'}`); }
    finally { setExporting(false); }
  };

  const handleJsxExport = async () => {
    setJsxExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('export-jsx-package', {
        body: { packageId, courseId: pkg.course_id },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (res.error) throw res.error;
      const resData = res.data as Record<string, unknown>;
      if (resData?.downloadUrl) {
        setJsxExportUrl(resData.downloadUrl as string);
        const a = document.createElement('a'); a.href = resData.downloadUrl as string; a.target = '_blank'; a.rel = 'noopener noreferrer';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        toast.success('JSX Export erstellt – Download geöffnet');
      }
    } catch (e: any) { toast.error(`JSX Export-Fehler: ${e?.message || 'Unbekannt'}`); }
    finally { setJsxExporting(false); }
  };

  const handleStoreListing = async (store: 'apple' | 'google') => {
    const setLoading = store === 'apple' ? setAppleLoading : setGoogleLoading;
    const setListing = store === 'apple' ? setAppleListing : setGoogleListing;
    setLoading(true);
    try {
      const res = await supabase.functions.invoke('generate-store-listing', {
        body: { packageId, store },
      });
      if (res.error) throw res.error;
      const data = res.data as any;
      if (data?.listing) {
        setListing(data.listing);
        toast.success(`${store === 'apple' ? 'App Store' : 'Play Store'} Listing generiert`);
      }
    } catch (e: any) {
      toast.error(`Store-Listing Fehler: ${e?.message || 'Unbekannt'}`);
    } finally {
      setLoading(false);
    }
  };

  const exports = [
    { key: 'zip', label: 'ZIP Package Export', desc: 'Komplett: Lernkurs + Fragen + Oral + Tutor + Handbuch', icon: '📦', action: handleExport, actionLabel: 'Exportieren', loading: exporting },
    { key: 'jsx', label: 'JSX Export', desc: 'React/Content Pack (Module + Lessons + Handbuch)', icon: '⚛️', action: handleJsxExport, actionLabel: 'JSX Exportieren', loading: jsxExporting },
    { key: 'json', label: 'JSON SSOT Snapshot', desc: 'Curriculum + Plan + Blueprints + Coverage', icon: '🗂' },
    { key: 'csv', label: 'Questions CSV/QTI', desc: 'Fragenpool als CSV oder QTI-Format', icon: '📊' },
    { key: 'handbook', label: 'Handbuch PDF/MD', desc: 'Handbuch als PDF oder Markdown', icon: '📖' },
  ];

  return (
    <div className="space-y-4">
      {/* Download banners */}
      {exportUrl && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-3">
            <Download className="h-5 w-5 text-success shrink-0" />
            <div className="flex-1 min-w-0"><p className="text-sm font-medium">ZIP-Export bereit</p><p className="text-xs text-muted-foreground">Link gültig für 1 Stunde</p></div>
            <Button size="sm" asChild><a href={exportUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3 mr-1" /> Herunterladen</a></Button>
          </CardContent>
        </Card>
      )}
      {jsxExportUrl && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-3">
            <Download className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0"><p className="text-sm font-medium">JSX Export bereit</p><p className="text-xs text-muted-foreground">Link gültig für 1 Stunde</p></div>
            <Button size="sm" asChild><a href={jsxExportUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3 mr-1" /> Herunterladen</a></Button>
          </CardContent>
        </Card>
      )}

      {/* Standard exports */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {exports.map(exp => (
          <Card key={exp.key} className="hover:border-primary/30 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{exp.icon}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold">{exp.label}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{exp.desc}</p>
                  {exp.action ? (
                    <Button variant="outline" size="sm" className="mt-2" onClick={exp.action} disabled={exp.loading || pkg.status === 'planning'}>
                      {exp.loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />} {exp.actionLabel}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="mt-2" disabled={pkg.status !== 'published'}>
                      <Download className="h-3 w-3 mr-1" /> Exportieren
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── App Store Exports ── */}
      <div className="pt-2">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Smartphone className="h-4 w-4" /> App Store & Play Store Export
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Apple App Store */}
          <Card className="hover:border-primary/30 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Apple className="h-7 w-7 text-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold">Apple App Store</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ASO-optimiertes Listing, Datenschutz, Screenshots & Checkliste für iOS
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50">IPA/Xcode</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50">ASO</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50">DSGVO</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50">DSA</span>
                  </div>
                  <Button
                    variant="outline" size="sm" className="mt-2 gap-1"
                    onClick={() => handleStoreListing('apple')}
                    disabled={appleLoading}
                  >
                    {appleLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {appleListing ? 'Neu generieren' : 'KI-Listing generieren'}
                  </Button>
                </div>
              </div>
              {appleListing && <StoreListingPanel listing={appleListing} store="apple" />}
            </CardContent>
          </Card>

          {/* Google Play Store */}
          <Card className="hover:border-primary/30 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Smartphone className="h-7 w-7 text-green-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold">Google Play Store</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ASO-optimiertes Listing, Data Safety, Screenshots & Checkliste für Android
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50">AAB</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50">ASO</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50">DSGVO</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50">Data Safety</span>
                  </div>
                  <Button
                    variant="outline" size="sm" className="mt-2 gap-1"
                    onClick={() => handleStoreListing('google')}
                    disabled={googleLoading}
                  >
                    {googleLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {googleListing ? 'Neu generieren' : 'KI-Listing generieren'}
                  </Button>
                </div>
              </div>
              {googleListing && <StoreListingPanel listing={googleListing} store="google" />}
            </CardContent>
          </Card>
        </div>

        {/* Capacitor Info */}
        <Card className="mt-3 border-border/30 bg-muted/10">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">
              <strong>Technischer Hinweis:</strong> Capacitor ist bereits konfiguriert (iOS + Android). 
              Für den Store-Upload: Projekt via GitHub exportieren → <code className="text-[10px] bg-muted/50 px-1 rounded">npx cap sync</code> → 
              Xcode (iOS) bzw. Android Studio (Android) → Signieren → Hochladen.
              Die KI generiert alle Store-Texte, Metadaten und Checklisten direkt aus den echten Kursinhalten.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
