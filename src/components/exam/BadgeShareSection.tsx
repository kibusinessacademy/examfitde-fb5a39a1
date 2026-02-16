import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Award, Share2, Copy, Check, MessageCircle, Linkedin, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface UserBadge {
  id: string;
  badge_key: string;
  badge_label: string;
  badge_icon: string;
  earned_at: string;
  metadata: Record<string, unknown> | null;
}

interface BadgeShareSectionProps {
  scorePercent: number;
  passed: boolean;
  sessionId?: string;
}

const ICON_MAP: Record<string, string> = {
  streak_7: '🔥',
  rechenprofi: '🧮',
  normensicher: '📏',
  pruefung_bereit: '🏆',
  first_sim: '🎯',
  perfect_score: '💯',
  kompetenz_master: '⭐',
  lernfeld_complete: '📚',
};

export function BadgeShareSection({ scorePercent, passed, sessionId }: BadgeShareSectionProps) {
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [newBadges, setNewBadges] = useState<UserBadge[]>([]);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Fetch badges earned in the last 5 minutes (= "new" from this session)
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const [allRes, newRes, refRes] = await Promise.all([
        supabase
          .from('user_badges')
          .select('id, badge_key, badge_label, badge_icon, earned_at, metadata')
          .eq('user_id', user.id)
          .order('earned_at', { ascending: false })
          .limit(8),
        supabase
          .from('user_badges')
          .select('id, badge_key, badge_label, badge_icon, earned_at, metadata')
          .eq('user_id', user.id)
          .gte('earned_at', fiveMinAgo)
          .order('earned_at', { ascending: false }),
        supabase
          .from('referral_invites')
          .select('invite_code')
          .eq('inviter_id', user.id)
          .is('claimed_by', null)
          .limit(1),
      ]);

      if (allRes.data) setBadges(allRes.data as UserBadge[]);
      if (newRes.data) setNewBadges(newRes.data as UserBadge[]);

      if (refRes.data && refRes.data.length > 0) {
        setReferralCode(refRes.data[0].invite_code);
      } else {
        // Generate a referral code if none exists
        const code = `EF-${user.id.slice(0, 6).toUpperCase()}`;
        await supabase.from('referral_invites').insert({
          inviter_id: user.id,
          invite_code: code,
        });
        setReferralCode(code);
      }

      setLoading(false);
    }
    load();
  }, []);

  const shareText = passed
    ? `🏆 Ich habe meine Prüfungssimulation mit ${scorePercent.toFixed(0)}% bestanden! Trainierst du schon?`
    : `📊 ${scorePercent.toFixed(0)}% in meiner Prüfungssimulation – ich trainiere weiter!`;

  const shareUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const fullShareText = referralCode
    ? `${shareText}\n👉 Mit Code ${referralCode} bekommst du 7 Tage Pro gratis!\n${shareUrl}`
    : `${shareText}\n${shareUrl}`;

  const recordShare = async (channel: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase.functions.invoke('growth-actions-api', {
        body: {
          action: 'record_share',
          payload: {
            channel,
            score: scorePercent,
            passed,
            sessionId,
            referralCode,
          },
        },
      });
    } catch { /* silent */ }
  };

  const handleWhatsApp = () => {
    recordShare('whatsapp');
    window.open(`https://wa.me/?text=${encodeURIComponent(fullShareText)}`, '_blank');
  };

  const handleLinkedIn = () => {
    recordShare('linkedin');
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`, '_blank');
  };

  const handleCopy = async () => {
    recordShare('copy');
    await navigator.clipboard.writeText(fullShareText);
    setCopied(true);
    toast({ title: 'Einladung kopiert!' });
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return null;

  const hasNewBadges = newBadges.length > 0;

  return (
    <div className="space-y-4">
      {/* New Badge Celebration */}
      {hasNewBadges && (
        <Card className="glass-card border-primary/50 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent pointer-events-none" />
          <CardContent className="pt-6 pb-5 text-center relative">
            <Sparkles className="h-6 w-6 text-primary mx-auto mb-2 animate-pulse" />
            <h3 className="text-lg font-display font-bold mb-3">
              {newBadges.length === 1 ? 'Neues Badge verdient!' : `${newBadges.length} neue Badges verdient!`}
            </h3>
            <div className="flex flex-wrap justify-center gap-3">
              {newBadges.map((b) => (
                <div key={b.id} className="flex flex-col items-center gap-1">
                  <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center text-2xl shadow-glow-sm">
                    {ICON_MAP[b.badge_key] || b.badge_icon || '🏅'}
                  </div>
                  <span className="text-xs font-medium">{b.badge_label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Share CTA */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Share2 className="h-4 w-4 text-primary" />
            Erfolg teilen & Freunde einladen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Referral message */}
          <p className="text-sm text-muted-foreground">
            {passed
              ? '🎉 Teile deinen Erfolg – deine Freunde bekommen 7 Tage Pro gratis!'
              : '💪 Gemeinsam lernt es sich besser – lade Klassenkameraden ein!'}
          </p>

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
              {copied ? 'Kopiert!' : 'Einladung kopieren'}
            </Button>
          </div>

          {/* Referral Code */}
          {referralCode && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
              <span>Dein Empfehlungscode:</span>
              <code className="font-mono text-foreground font-semibold">{referralCode}</code>
            </div>
          )}

          {/* All Badges Row */}
          {badges.length > 0 && !hasNewBadges && (
            <div className="pt-2 border-t border-border">
              <div className="flex items-center gap-1.5 mb-2">
                <Award className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Deine Badges</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {badges.map((b) => (
                  <Badge key={b.id} variant="secondary" className="gap-1 py-0.5 px-2 text-xs">
                    <span>{ICON_MAP[b.badge_key] || b.badge_icon || '🏅'}</span>
                    {b.badge_label}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
