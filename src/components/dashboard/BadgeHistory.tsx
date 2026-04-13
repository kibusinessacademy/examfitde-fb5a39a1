import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Award, Trophy, Target, Flame, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UserBadge {
  id: string;
  badge_key: string;
  badge_label: string;
  badge_icon: string;
  earned_at: string;
}

const ICON_MAP: Record<string, { emoji: string; color: string }> = {
  streak_7: { emoji: '🔥', color: 'from-orange-500/20 to-red-500/20' },
  rechenprofi: { emoji: '🧮', color: 'from-blue-500/20 to-indigo-500/20' },
  normensicher: { emoji: '📏', color: 'from-green-500/20 to-emerald-500/20' },
  pruefung_bereit: { emoji: '🏆', color: 'from-yellow-500/20 to-amber-500/20' },
  first_sim: { emoji: '🎯', color: 'from-primary/20 to-primary/10' },
  perfect_score: { emoji: '💯', color: 'from-purple-500/20 to-pink-500/20' },
  kompetenz_master: { emoji: '⭐', color: 'from-yellow-500/20 to-orange-500/20' },
  lernfeld_complete: { emoji: '📚', color: 'from-teal-500/20 to-cyan-500/20' },
};

export function BadgeHistory() {
  const { user } = useAuth();
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_badges')
      .select('id, badge_key, badge_label, badge_icon, earned_at')
      .eq('user_id', user.id)
      .order('earned_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data) setBadges(data.map(d => ({ ...d, badge_icon: d.badge_icon ?? '' })));
        setLoading(false);
      });
  }, [user]);

  if (loading || badges.length === 0) return null;

  return (
    <Card className="glass-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Award className="h-5 w-5 text-primary" />
          Deine Erfolge
          <Badge variant="secondary" className="ml-auto text-[10px]">{badges.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {badges.map((b) => {
            const style = ICON_MAP[b.badge_key] ?? { emoji: b.badge_icon || '🏅', color: 'from-muted to-muted' };
            return (
              <div key={b.id} className="flex flex-col items-center gap-1.5 group">
                <div className={cn(
                  "w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-xl",
                  "border border-border/50 group-hover:border-primary/30 transition-colors",
                  style.color
                )}>
                  {style.emoji}
                </div>
                <span className="text-[11px] font-medium text-center leading-tight line-clamp-2">
                  {b.badge_label}
                </span>
                <span className="text-[9px] text-muted-foreground">
                  {new Date(b.earned_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
