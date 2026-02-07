import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BookOpen, AlertTriangle, ChevronRight, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface RecommendedLesson {
  lesson_id: string;
  lesson_title: string;
  module_title: string;
  course_id: string;
  course_title: string;
  step: string;
}

interface CompetencyRecommendation {
  competency_id: string;
  competency_code: string;
  competency_title: string;
  learning_field_code: string;
  learning_field_title: string;
  correct_count: number;
  total_count: number;
  score_percent: number;
  recommended_lessons: RecommendedLesson[];
}

interface LessonRecommendationsProps {
  sessionId: string;
}

export function LessonRecommendations({ sessionId }: LessonRecommendationsProps) {
  const navigate = useNavigate();
  
  const { data: recommendations, isLoading } = useQuery({
    queryKey: ['exam-lesson-recommendations', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_exam_lesson_recommendations', {
          p_session_id: sessionId,
        });
      
      if (error) throw error;
      
      // Parse recommended_lessons from JSONB
      return (data || []).map((rec: Record<string, unknown>) => ({
        ...rec,
        recommended_lessons: (rec.recommended_lessons || []) as RecommendedLesson[],
      })) as CompetencyRecommendation[];
    },
    enabled: !!sessionId,
  });
  
  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  
  if (!recommendations || recommendations.length === 0) {
    return null;
  }
  
  const handleLessonClick = (courseId: string, lessonId: string) => {
    navigate(`/lesson/${lessonId}`);
  };
  
  return (
    <Card className="glass-card border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary">
          <AlertTriangle className="h-5 w-5" />
          Empfohlene Lektionen
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Basierend auf deinen Schwächen empfehlen wir folgende Lektionen zur Wiederholung:
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {recommendations.map((rec) => (
          <div 
            key={rec.competency_id} 
            className="p-4 rounded-lg border bg-card/50"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">
                    {rec.learning_field_code || 'LF'}
                  </Badge>
                  <Badge 
                    variant={rec.score_percent < 50 ? "destructive" : "secondary"}
                  >
                    {rec.score_percent}%
                  </Badge>
                </div>
                <h4 className="font-medium">
                  {rec.competency_title || rec.competency_code}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {rec.correct_count} von {rec.total_count} Fragen richtig
                </p>
              </div>
            </div>
            
            {rec.recommended_lessons.length > 0 ? (
              <div className="space-y-2 mt-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Empfohlene Lektionen:
                </p>
                {rec.recommended_lessons.slice(0, 3).map((lesson) => (
                  <Button
                    key={lesson.lesson_id}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-left h-auto py-2"
                    onClick={() => handleLessonClick(lesson.course_id, lesson.lesson_id)}
                  >
                    <BookOpen className="h-4 w-4 mr-2 flex-shrink-0 text-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{lesson.lesson_title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {lesson.course_title} • {lesson.module_title}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 ml-2 text-muted-foreground" />
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic mt-2">
                Keine passenden Lektionen verfügbar.
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
