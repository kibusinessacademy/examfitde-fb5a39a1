import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { 
  Star, 
  ThumbsUp, 
  CheckCircle, 
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Send
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface CourseReviewsProps {
  courseId: string;
  showWriteReview?: boolean;
}

interface Review {
  id: string;
  user_id: string;
  rating: number;
  title: string | null;
  content: string | null;
  is_verified_purchase: boolean;
  helpful_count: number;
  created_at: string;
}

export function CourseReviews({ courseId, showWriteReview = true }: CourseReviewsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newRating, setNewRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const queryClient = useQueryClient();

  const { data: reviews, isLoading } = useQuery({
    queryKey: ['course-reviews', courseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_reviews')
        .select('*')
        .eq('course_id', courseId)
        .eq('status', 'published')
        .order('helpful_count', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Review[];
    }
  });

  const submitReviewMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Nicht angemeldet');

      const { error } = await supabase
        .from('course_reviews')
        .insert({
          course_id: courseId,
          user_id: user.id,
          rating: newRating,
          title: newTitle || null,
          content: newContent || null,
          is_verified_purchase: true // TODO: Check actual purchase
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-reviews', courseId] });
      setShowForm(false);
      setNewRating(0);
      setNewTitle('');
      setNewContent('');
      toast.success('Bewertung wurde veröffentlicht');
    },
    onError: (error: Error) => {
      if (error.message.includes('duplicate')) {
        toast.error('Du hast diesen Kurs bereits bewertet');
      } else {
        toast.error('Fehler beim Speichern');
      }
    }
  });

  const markHelpfulMutation = useMutation({
    mutationFn: async (reviewId: string) => {
      // Direct update statt RPC
      const { error } = await supabase
        .from('course_reviews')
        .update({ helpful_count: typeof supabase.rpc === 'function' ? undefined : 1 }) // Fallback
        .eq('id', reviewId);
      
      // Alternativ: Increment via raw SQL simulieren
      const { data, error: fetchError } = await supabase
        .from('course_reviews')
        .select('helpful_count')
        .eq('id', reviewId)
        .single();
      
      if (fetchError) throw fetchError;
      
      const { error: updateError } = await supabase
        .from('course_reviews')
        .update({ helpful_count: (data?.helpful_count || 0) + 1 })
        .eq('id', reviewId);
      
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-reviews', courseId] });
    }
  });

  // Calculate stats
  const totalReviews = reviews?.length || 0;
  const avgRating = totalReviews > 0 
    ? reviews!.reduce((acc, r) => acc + r.rating, 0) / totalReviews 
    : 0;
  
  const ratingDistribution = [5, 4, 3, 2, 1].map(rating => ({
    rating,
    count: reviews?.filter(r => r.rating === rating).length || 0,
    percent: totalReviews > 0 
      ? ((reviews?.filter(r => r.rating === rating).length || 0) / totalReviews) * 100 
      : 0
  }));

  const displayedReviews = isExpanded ? reviews : reviews?.slice(0, 3);

  const renderStars = (rating: number, interactive = false) => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            "h-5 w-5 transition-colors",
            interactive && "cursor-pointer hover:scale-110",
            star <= (interactive ? (hoverRating || newRating) : rating)
              ? "fill-yellow-400 text-yellow-400"
              : "text-muted-foreground/30"
          )}
          onMouseEnter={() => interactive && setHoverRating(star)}
          onMouseLeave={() => interactive && setHoverRating(0)}
          onClick={() => interactive && setNewRating(star)}
        />
      ))}
    </div>
  );

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Bewertungen
          {totalReviews > 0 && (
            <Badge variant="secondary" className="ml-2">
              {totalReviews}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary */}
        {totalReviews > 0 && (
          <div className="flex gap-8 items-start">
            {/* Average Rating */}
            <div className="text-center">
              <div className="text-5xl font-bold">{avgRating.toFixed(1)}</div>
              {renderStars(Math.round(avgRating))}
              <div className="text-sm text-muted-foreground mt-1">
                {totalReviews} {totalReviews === 1 ? 'Bewertung' : 'Bewertungen'}
              </div>
            </div>

            {/* Distribution */}
            <div className="flex-1 space-y-2">
              {ratingDistribution.map(({ rating, count, percent }) => (
                <div key={rating} className="flex items-center gap-2">
                  <span className="text-sm w-3">{rating}</span>
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-yellow-400 transition-all"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-8">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Write Review Button/Form */}
        {showWriteReview && !showForm && (
          <Button 
            variant="outline" 
            onClick={() => setShowForm(true)}
            className="w-full"
          >
            <Star className="h-4 w-4 mr-2" />
            Bewertung schreiben
          </Button>
        )}

        {showForm && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4 space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Deine Bewertung</label>
                {renderStars(newRating, true)}
              </div>
              <div>
                <Input
                  placeholder="Titel (optional)"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
              </div>
              <div>
                <Textarea
                  placeholder="Deine Meinung zum Kurs..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={() => submitReviewMutation.mutate()}
                  disabled={newRating === 0 || submitReviewMutation.isPending}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Absenden
                </Button>
                <Button variant="ghost" onClick={() => setShowForm(false)}>
                  Abbrechen
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Reviews List */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-muted/50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : totalReviews === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Noch keine Bewertungen vorhanden.
          </div>
        ) : (
          <div className="space-y-4">
            {displayedReviews?.map((review) => (
              <div key={review.id} className="border-b pb-4 last:border-0">
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>
                      {review.user_id.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {renderStars(review.rating)}
                      {review.is_verified_purchase && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Verifizierter Kauf
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {format(new Date(review.created_at), 'dd.MM.yyyy', { locale: de })}
                      </span>
                    </div>
                    {review.title && (
                      <div className="font-medium mt-1">{review.title}</div>
                    )}
                    {review.content && (
                      <p className="text-sm text-muted-foreground mt-1">{review.content}</p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-muted-foreground hover:text-foreground"
                      onClick={() => markHelpfulMutation.mutate(review.id)}
                    >
                      <ThumbsUp className="h-4 w-4 mr-1" />
                      Hilfreich ({review.helpful_count})
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Show More/Less */}
        {totalReviews > 3 && (
          <Button 
            variant="ghost" 
            className="w-full"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-2" />
                Weniger anzeigen
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-2" />
                Alle {totalReviews} Bewertungen anzeigen
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}