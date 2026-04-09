import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePartnerContentJobs, useGeneratePartnerContent } from '@/hooks/usePartnerSystem';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, Sparkles, Loader2, Video, Mail, FileText, MessageSquare, Zap, Target } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  partnerId: string;
}

const CONTENT_TYPES = [
  { value: 'tiktok_video', label: 'TikTok / Reels Skript', icon: Video },
  { value: 'instagram_reel', label: 'Instagram Reel', icon: Video },
  { value: 'ad_copy', label: 'Anzeigentext', icon: Target },
  { value: 'email_sequence', label: 'E-Mail Sequenz', icon: Mail },
  { value: 'landingpage', label: 'Landingpage Copy', icon: FileText },
  { value: 'hook_generator', label: 'Hook Generator', icon: Zap },
  { value: 'fehleranalyse_post', label: 'Fehleranalyse Post', icon: MessageSquare },
];

const PLATFORMS = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'meta_ads', label: 'Meta Ads' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'email', label: 'E-Mail' },
  { value: 'landingpage', label: 'Landingpage' },
  { value: 'linkedin', label: 'LinkedIn' },
];

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: 'Wartend', color: 'bg-muted text-muted-foreground' },
  generating: { label: 'Generiert...', color: 'bg-primary/10 text-primary' },
  completed: { label: 'Fertig', color: 'bg-accent/10 text-accent' },
  failed: { label: 'Fehler', color: 'bg-destructive/10 text-destructive' },
};

export function PartnerContentTab({ partnerId }: Props) {
  const { data: jobs, isLoading } = usePartnerContentJobs(partnerId);
  const generate = useGeneratePartnerContent();
  const [contentType, setContentType] = useState('tiktok_video');
  const [platform, setPlatform] = useState('tiktok');
  const [selectedJob, setSelectedJob] = useState<any>(null);

  const handleGenerate = async () => {
    try {
      const result = await generate.mutateAsync({
        partner_id: partnerId,
        content_type: contentType,
        platform,
        // Use a random question/blueprint approach - the edge function will handle fallback
        competency_id: undefined,
      });
      toast.success('Content generiert!');
      setSelectedJob(result);
    } catch (e: any) {
      toast.error(e.message || 'Fehler bei der Generierung');
    }
  };

  const copyOutput = (output: any) => {
    const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    navigator.clipboard.writeText(text);
    toast.success('Content kopiert!');
  };

  return (
    <div className="space-y-6">
      {/* Generator */}
      <Card className="glass-card border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Content Engine
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Generiere conversion-optimierten Marketing-Content basierend auf echten Prüfungsinhalten.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Content-Typ</label>
              <Select value={contentType} onValueChange={setContentType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPES.map(ct => (
                    <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Plattform</label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleGenerate}
                disabled={generate.isPending}
                className="w-full gradient-primary text-primary-foreground"
              >
                {generate.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generiert...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" /> Content generieren</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Latest Result */}
      {selectedJob?.output && (
        <Card className="glass-card border-accent/20">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm">Generierter Content</CardTitle>
              {selectedJob.hook && (
                <p className="text-xs text-muted-foreground mt-1">Hook: „{selectedJob.hook}"</p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => copyOutput(selectedJob.output)}>
              <Copy className="h-3 w-3 mr-1" /> Alles kopieren
            </Button>
          </CardHeader>
          <CardContent>
            <ContentOutput output={selectedJob.output} />
          </CardContent>
        </Card>
      )}

      {/* History */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Content-Historie</h3>
        {isLoading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : jobs?.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            Noch kein Content generiert. Starte oben mit der Content Engine!
          </div>
        ) : (
          <div className="space-y-3">
            {jobs?.map((job: any) => {
              const st = statusConfig[job.status] || statusConfig.pending;
              const ct = CONTENT_TYPES.find(c => c.value === job.content_type);
              const Icon = ct?.icon || FileText;
              return (
                <Card
                  key={job.id}
                  className="glass-card cursor-pointer hover:border-primary/20 transition-colors"
                  onClick={() => job.output && setSelectedJob(job)}
                >
                  <CardContent className="py-3 flex items-center gap-3">
                    <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium">{ct?.label || job.content_type}</span>
                        <Badge variant="outline" className="text-[10px]">{job.platform}</Badge>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                      </div>
                      {job.hook && <p className="text-xs text-muted-foreground truncate">„{job.hook}"</p>}
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {new Date(job.created_at).toLocaleDateString('de-DE')}
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ContentOutput({ output }: { output: any }) {
  if (!output) return null;

  if (output.raw) {
    return <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-4 max-h-96 overflow-auto">{output.raw}</pre>;
  }

  const copyField = (value: string) => {
    navigator.clipboard.writeText(value);
    toast.success('Kopiert!');
  };

  return (
    <div className="space-y-3 max-h-[500px] overflow-auto">
      {Object.entries(output).map(([key, value]) => {
        if (typeof value === 'string') {
          return (
            <div key={key} className="bg-muted/30 rounded-lg p-3 group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground uppercase">{key.replace(/_/g, ' ')}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => copyField(value)}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <p className="text-sm">{value}</p>
            </div>
          );
        }
        if (Array.isArray(value)) {
          return (
            <div key={key} className="bg-muted/30 rounded-lg p-3">
              <span className="text-xs font-medium text-muted-foreground uppercase block mb-1">{key.replace(/_/g, ' ')}</span>
              <div className="flex flex-wrap gap-1">
                {value.map((item, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{typeof item === 'string' ? item : JSON.stringify(item)}</Badge>
                ))}
              </div>
            </div>
          );
        }
        if (typeof value === 'object' && value) {
          return (
            <div key={key} className="bg-muted/30 rounded-lg p-3">
              <span className="text-xs font-medium text-muted-foreground uppercase block mb-2">{key.replace(/_/g, ' ')}</span>
              {Object.entries(value as Record<string, any>).map(([subKey, subVal]) => (
                <div key={subKey} className="mb-2 last:mb-0">
                  <span className="text-[10px] text-muted-foreground uppercase">{subKey.replace(/_/g, ' ')}</span>
                  <p className="text-sm">{typeof subVal === 'string' ? subVal : JSON.stringify(subVal)}</p>
                </div>
              ))}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
