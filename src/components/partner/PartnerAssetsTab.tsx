import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePartnerAssets } from '@/hooks/usePartnerSystem';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, Download, Image, FileText, Video, Mail, Link2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

interface Props { partnerType: string; }

const typeIcons: Record<string, typeof Image> = {
  banner: Image,
  landingpage_copy: FileText,
  email_copy: Mail,
  ad_copy: MessageSquare,
  video_script: Video,
  social_post: MessageSquare,
  pdf: FileText,
  link_bundle: Link2,
};

const typeLabels: Record<string, string> = {
  banner: 'Banner',
  landingpage_copy: 'Landing Page Copy',
  email_copy: 'E-Mail Copy',
  ad_copy: 'Anzeigentext',
  video_script: 'Video-Skript',
  social_post: 'Social Post',
  pdf: 'PDF',
  link_bundle: 'Link-Bundle',
};

export function PartnerAssetsTab({ partnerType }: Props) {
  const { data: assets, isLoading } = usePartnerAssets();

  if (isLoading) return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;

  const filtered = assets?.filter((a: any) => a.audience === 'all' || a.audience === partnerType) || [];

  const copyContent = (asset: any) => {
    const text = asset.content_json?.text || asset.content_json?.copy || JSON.stringify(asset.content_json);
    navigator.clipboard.writeText(text);
    toast.success('Inhalt kopiert!');
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {filtered.map((asset: any) => {
        const Icon = typeIcons[asset.asset_type] || FileText;
        return (
          <Card key={asset.id} className="glass-card">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-primary" />
                  <Badge variant="outline" className="text-xs">
                    {typeLabels[asset.asset_type] || asset.asset_type}
                  </Badge>
                </div>
              </div>
              <CardTitle className="text-sm">{asset.title}</CardTitle>
            </CardHeader>
            <CardContent>
              {asset.description && <p className="text-xs text-muted-foreground mb-3">{asset.description}</p>}
              <div className="flex gap-2">
                {asset.content_json && (
                  <Button variant="outline" size="sm" onClick={() => copyContent(asset)}>
                    <Copy className="h-3 w-3 mr-1" /> Kopieren
                  </Button>
                )}
                {asset.file_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={asset.file_url} download target="_blank" rel="noopener">
                      <Download className="h-3 w-3 mr-1" /> Download
                    </a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
      {filtered.length === 0 && (
        <div className="col-span-full text-center text-muted-foreground py-8">
          Noch keine Werbemittel verfügbar
        </div>
      )}
    </div>
  );
}
