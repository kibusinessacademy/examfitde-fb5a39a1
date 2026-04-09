import { useState } from 'react';
import { Copy, Check, Linkedin, Mail, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import type { ShareEvent } from '@/types/share';
import { buildShareText, buildShareUrl, buildWhatsAppLink, buildLinkedInLink } from '@/lib/share-utils';
import { toast } from '@/hooks/use-toast';

interface ShareSuccessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: ShareEvent | null;
}

export function ShareSuccessModal({ open, onOpenChange, event }: ShareSuccessModalProps) {
  const [copied, setCopied] = useState(false);

  if (!event) return null;

  const text = buildShareText(event);
  const url = buildShareUrl(event.curriculum_id);
  const fullText = `${text}\n${url}`;

  const track = async (channel: string, actionType = 'share_clicked') => {
    try {
      await supabase.from('share_actions' as any).insert({
        share_event_id: event.id,
        user_id: event.user_id,
        action_type: actionType,
        channel,
        platform: channel,
        meta: { event_type: event.event_type },
      });
      // Mark event as shared
      await supabase
        .from('share_events' as any)
        .update({ event_status: 'shared', consumed_at: new Date().toISOString() })
        .eq('id', event.id);
    } catch { /* non-blocking */ }
  };

  const handleWhatsApp = () => {
    track('whatsapp');
    window.open(buildWhatsAppLink(text, url), '_blank');
  };

  const handleLinkedIn = () => {
    track('linkedin');
    window.open(buildLinkedInLink(url), '_blank');
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(fullText);
    setCopied(true);
    toast({ title: 'Text kopiert!' });
    track('copy', 'share_copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDismiss = async () => {
    try {
      await supabase
        .from('share_events' as any)
        .update({ event_status: 'dismissed', consumed_at: new Date().toISOString() })
        .eq('id', event.id);
    } catch { /* silent */ }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">🏆 {event.title}</DialogTitle>
          <DialogDescription>
            {event.subtitle}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/50 p-4">
          <p className="text-sm leading-relaxed">{text}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button className="gap-2" onClick={handleWhatsApp}>
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleLinkedIn}>
            <Linkedin className="h-4 w-4" />
            LinkedIn
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Kopiert!' : 'Kopieren'}
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => {
            track('email');
            const subject = encodeURIComponent(event.title);
            const body = encodeURIComponent(fullText);
            window.open(`mailto:?subject=${subject}&body=${body}`);
          }}>
            <Mail className="h-4 w-4" />
            E-Mail
          </Button>
        </div>

        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleDismiss}>
          Nicht teilen
        </Button>
      </DialogContent>
    </Dialog>
  );
}
