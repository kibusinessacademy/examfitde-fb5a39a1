import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Award, Share2, Copy, Check, MessageCircle, Linkedin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface UserBadge {
  id: string;
  badge_key: string;
  badge_label: string;
  badge_icon: string;
  earned_at: string;
}

interface BadgeShareSectionProps {
  scorePercent: number;
  passed: boolean;
}

const ICON_MAP: Record<string, string> = {
  streak_7: '🔥',
  rechenprofi: '🧮',
  normensicher: '📏',
  pruefung_bereit: '🏆',
  first_sim: '🎯',
  perfect_score: '💯',
};

export function BadgeShareSection({ scorePercent, passed }: BadgeShareSectionProps) {
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('user_badges')
        .select('id, badge_key, badge_label, badge_icon, earned_at')
        .eq('user_id', user.id)
        .order('earned_at', { ascending: false })
        .limit(6);

      if (data) setBadges(data);
    }
    load();
  }, []);

  const shareText = passed
    ? `🏆 Prüfungssimulation bestanden mit ${scorePercent.toFixed(0)}%! #ExamFit`
    : `📊 ${scorePercent.toFixed(0)}% in der Prüfungssimulation – weiter geht's! #ExamFit`;

  const shareUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const recordShare = async (channel: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase.functions.invoke('growth-actions-api', {
        body: { action: 'record_share', payload: { channel, score: scorePercent } },
      });
    } catch { /* silent */ }
  };

  const handleWhatsApp = () => {
    recordShare('whatsapp');
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`, '_blank');
  };

  const handleLinkedIn = () => {
    recordShare('linkedin');
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`, '_blank');
  };

  const handleCopy = async () => {
    recordShare('copy');
    await navigator.clipboard.writeText(shareText + ' ' + shareUrl);
    setCopied(true);
    toast({ title: 'Link kopiert!' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Award className="h-5 w-5 text-primary" />
          Deine Erfolge teilen
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Badges */}
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <Badge key={b.id} variant="secondary" className="gap-1.5 py-1 px-3 text-sm">
                <span>{ICON_MAP[b.badge_key] || b.badge_icon || '🏅'}</span>
                {b.badge_label}
              </Badge>
            ))}
          </div>
        )}

        {/* Share Buttons */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={handleWhatsApp}>
            <MessageCircle className="h-4 w-4" />
            WhatsApp
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleLinkedIn}>
            <Linkedin className="h-4 w-4" />
            LinkedIn
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Kopiert!' : 'Link kopieren'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
