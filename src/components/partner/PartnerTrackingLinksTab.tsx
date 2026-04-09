import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { usePartnerTrackingLinks, useCreatePartnerTrackingLink } from '@/hooks/usePartnerSystem';
import { Copy, Plus, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  partnerId: string;
  referralCode: string;
}

const SITE_URL = 'https://examfit.de';

export function PartnerTrackingLinksTab({ partnerId, referralCode }: Props) {
  const { data: links, isLoading } = usePartnerTrackingLinks(partnerId);
  const createLink = useCreatePartnerTrackingLink();
  const [showCreate, setShowCreate] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [newPath, setNewPath] = useState('/');
  const [newCampaign, setNewCampaign] = useState('');
  const [newChannel, setNewChannel] = useState('');

  const directLink = `${SITE_URL}/?ref=${referralCode}`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Link kopiert!');
  };

  const handleCreate = async () => {
    if (!newSlug.trim()) { toast.error('Slug ist erforderlich'); return; }
    try {
      await createLink.mutateAsync({
        partner_id: partnerId,
        slug: newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        target_path: newPath || '/',
        campaign_name: newCampaign || undefined,
        channel: newChannel || undefined,
      });
      toast.success('Link erstellt!');
      setShowCreate(false);
      setNewSlug(''); setNewPath('/'); setNewCampaign(''); setNewChannel('');
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Erstellen');
    }
  };

  return (
    <div className="space-y-6">
      {/* Direct Referral Link */}
      <Card className="glass-card border-primary/20">
        <CardHeader>
          <CardTitle className="text-sm">Dein Referral-Link</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-lg truncate">{directLink}</code>
            <Button variant="outline" size="icon" onClick={() => copyToClipboard(directLink)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Referral-Code: <strong>{referralCode}</strong></p>
        </CardContent>
      </Card>

      {/* Create Link */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Tracking-Links</h3>
        <Button onClick={() => setShowCreate(!showCreate)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Neuer Link
        </Button>
      </div>

      {showCreate && (
        <Card className="glass-card">
          <CardContent className="pt-6 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Slug (z.B. mein-link)" value={newSlug} onChange={e => setNewSlug(e.target.value)} />
              <Input placeholder="Zielseite (z.B. /shop)" value={newPath} onChange={e => setNewPath(e.target.value)} />
              <Input placeholder="Kampagne (optional)" value={newCampaign} onChange={e => setNewCampaign(e.target.value)} />
              <Input placeholder="Kanal (optional)" value={newChannel} onChange={e => setNewChannel(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Abbrechen</Button>
              <Button size="sm" onClick={handleCreate} disabled={createLink.isPending}>Erstellen</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Links Table */}
      <Card className="glass-card">
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Zielseite</TableHead>
                <TableHead>Kampagne</TableHead>
                <TableHead>Kanal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links?.map((link: any) => (
                <TableRow key={link.id}>
                  <TableCell className="font-mono text-sm">{link.slug}</TableCell>
                  <TableCell className="text-sm">{link.target_path}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{link.campaign_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{link.channel || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={link.is_active ? 'default' : 'secondary'}>
                      {link.is_active ? 'Aktiv' : 'Inaktiv'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => copyToClipboard(`${SITE_URL}/?ref=${referralCode}&slug=${link.slug}`)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(!links || links.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Noch keine Tracking-Links erstellt
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
