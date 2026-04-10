import { lazy, Suspense } from 'react';
import DOMPurify from 'dompurify';
import { Loader2, BookOpen, PlayCircle, AlertCircle, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Json } from '@/integrations/supabase/types';
import MiniCheckPlayer, { type MiniCheckContent, type MiniCheckQuestion } from './MiniCheckPlayer';
import { useLessonMiniChecks } from '@/hooks/useLessonMiniChecks';
import { useLessonAnswerKey } from '@/hooks/useLessonAnswerKey';
import LessonAnswerCheck from './LessonAnswerCheck';
const H5PPlayer = lazy(() => import('./H5PPlayer'));

interface LessonContentProps {
  content: Json | null;
  h5pContentId: string | null;
  lessonId?: string;
  certificationId?: string | null;
  competenceId?: string | null;
  onH5PCompleted?: (score?: number, maxScore?: number) => void;
  onH5PProgress?: (progress: number) => void;
  onMiniCheckCompleted?: (score: number, maxScore: number) => void;
}

interface ContentData {
  type?: string;
  html?: string;
  h5pContentId?: string;
  questions?: MiniCheckQuestion[];
  passing_score?: number;
  [key: string]: unknown;
}

// Quality Gate: Check if MiniCheck questions are valid (not generic/empty)
function isMiniCheckValid(questions: MiniCheckQuestion[]): { valid: boolean; reason?: string } {
  if (!questions || questions.length === 0) {
    return { valid: false, reason: 'Keine Fragen vorhanden' };
  }
  
  // Check for minimum number of questions
  if (questions.length < 3) {
    return { valid: false, reason: 'Zu wenige Fragen (mind. 3 erforderlich)' };
  }
  
  // Check each question has required fields and meaningful content
  for (const q of questions) {
    if (!q.text || q.text.trim().length < 10) {
      return { valid: false, reason: 'Fragetexte sind noch in Bearbeitung' };
    }
    if (!q.options || q.options.length < 2) {
      return { valid: false, reason: 'Antwortoptionen fehlen' };
    }
    // Check for placeholder/generic text
    const genericPatterns = [
      /^frage\s*\d*$/i,
      /^option\s*[a-d]?$/i,
      /^placeholder/i,
      /^test$/i,
      /^beispiel/i,
    ];
    if (genericPatterns.some(p => p.test(q.text.trim()))) {
      return { valid: false, reason: 'Fragen werden noch verfeinert' };
    }
    // Check options are not placeholders
    const hasValidOptions = q.options.every(
      opt => opt.text && opt.text.trim().length > 2 && !genericPatterns.some(p => p.test(opt.text.trim()))
    );
    if (!hasValidOptions) {
      return { valid: false, reason: 'Antwortoptionen werden noch erstellt' };
    }
    // Ensure at least one correct answer (only check for inline JSON that has is_correct)
    // DB-backed questions don't expose is_correct — correctness is server-side only
    const hasIsCorrectField = q.options.some(opt => 'is_correct' in opt);
    if (hasIsCorrectField && !q.options.some(opt => opt.is_correct)) {
      return { valid: false, reason: 'Korrekte Antworten werden noch definiert' };
    }
  }
  
  return { valid: true };
}

// Placeholder component for content under construction
function ContentPlaceholder({ 
  icon: Icon, 
  title, 
  description,
  badge
}: { 
  icon: React.ElementType; 
  title: string; 
  description: string;
  badge?: string;
}) {
  return (
    <Card className="border-dashed border-2 bg-muted/20">
      <CardContent className="py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Icon className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-muted-foreground max-w-md mx-auto mb-4">
          {description}
        </p>
        {badge && (
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="h-3 w-3" />
            {badge}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

export default function LessonContent({ 
  content, 
  h5pContentId,
  lessonId,
  certificationId,
  competenceId,
  onH5PCompleted,
  onH5PProgress,
  onMiniCheckCompleted
}: LessonContentProps) {
  // Fetch DB-backed MiniChecks for this lesson (pipeline SSOT)
  const { data: dbMiniChecks, isLoading: dbMiniChecksLoading } = useLessonMiniChecks(lessonId);
  // Fetch answer key for interactive Einstieg/Anwenden steps
  const { data: answerKey } = useLessonAnswerKey(lessonId);

  // If there's a direct h5p_content_id on the lesson, use that
  if (h5pContentId) {
    return (
      <Suspense fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }>
        <H5PPlayer 
          contentId={h5pContentId}
          onCompleted={onH5PCompleted}
          onProgress={onH5PProgress}
        />
      </Suspense>
    );
  }

  // Handle content JSON
  if (!content) {
    // Even without inline content, check if DB has MiniChecks for this lesson
    if (dbMiniChecksLoading) {
      return (
        <div className="flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }
    if (dbMiniChecks && lessonId) {
      const validation = isMiniCheckValid(dbMiniChecks.questions);
      if (validation.valid) {
        return (
          <MiniCheckPlayer
            content={dbMiniChecks}
            lessonId={lessonId}
            onCompleted={onMiniCheckCompleted}
          />
        );
      }
    }
    return (
      <ContentPlaceholder
        icon={BookOpen}
        title="Inhalte werden erstellt"
        description="Die Lerninhalte für diese Lektion werden noch von der KI generiert. Bitte schauen Sie später wieder vorbei."
        badge="In Arbeit"
      />
    );
  }

  const contentData = content as ContentData;

  // H5P content from content JSON
  if (contentData.type === 'h5p' && contentData.h5pContentId) {
    return (
      <Suspense fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }>
        <H5PPlayer 
          contentId={String(contentData.h5pContentId)}
          onCompleted={onH5PCompleted}
          onProgress={onH5PProgress}
        />
      </Suspense>
    );
  }

  // Text/HTML content
  if (contentData.type === 'text' && contentData.html) {
    const sanitizedHTML = DOMPurify.sanitize(String(contentData.html), {
      ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'sub', 'sup', 'hr'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'],
      ALLOW_DATA_ATTR: false,
    });
    return (
      <div className="space-y-4">
        <div 
          className="prose prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitizedHTML }} 
        />
        {/* Answer check for Einstieg/Anwenden steps */}
        {answerKey && lessonId && (
          <LessonAnswerCheck
            lessonId={lessonId}
            exemplarAnswer={answerKey.exemplar_answer}
          />
        )}
      </div>
    );
  }

  // Quiz / Mini-Check content — prefer DB-backed MiniChecks (SSOT) over inline JSON
  if (contentData.type === 'quiz' || contentData.type === 'mini_check') {
    // Use DB MiniChecks if available (pipeline SSOT), fallback to inline JSON
    const source = dbMiniChecks ?? (contentData as unknown as MiniCheckContent);
    
    // Quality Gate Check
    const validation = isMiniCheckValid(source.questions || []);
    
    if (!validation.valid || !lessonId) {
      return (
        <ContentPlaceholder
          icon={AlertCircle}
          title="Mini-Check wird optimiert"
          description={validation.reason || 'Die Wissensüberprüfung wird gerade von unserer KI verbessert, um dir das beste Lernerlebnis zu bieten.'}
          badge="Qualitätsprüfung"
        />
      );
    }
    
    return (
      <MiniCheckPlayer 
        content={source}
        lessonId={lessonId}
        onCompleted={onMiniCheckCompleted}
      />
    );
  }

  // No inline quiz type, but DB has MiniChecks for this lesson (text + minicheck combo)
  if (dbMiniChecks && lessonId) {
    const validation = isMiniCheckValid(dbMiniChecks.questions);
    if (validation.valid) {
      return (
        <div className="space-y-8">
          {/* Render text content first if present */}
          {contentData.type === 'text' && contentData.html && (
            <div 
              className="prose prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(contentData.html), {
                ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','strong','em','u','ul','ol','li','blockquote','code','pre','a','img','table','thead','tbody','tr','th','td','span','div','sub','sup','hr'],
                ALLOWED_ATTR: ['href','src','alt','title','class','id','target','rel'],
                ALLOW_DATA_ATTR: false,
              }) }}
            />
          )}
          <MiniCheckPlayer
            content={dbMiniChecks}
            lessonId={lessonId}
            onCompleted={onMiniCheckCompleted}
          />
        </div>
      );
    }
  }

  // H5P placeholder (when type is h5p but no contentId yet)
  if (contentData.type === 'h5p') {
    return (
      <ContentPlaceholder
        icon={PlayCircle}
        title="Interaktive Inhalte laden"
        description="Die interaktiven Elemente für diese Lektion werden vorbereitet."
        badge="H5P wird geladen"
      />
    );
  }

  // Fallback: show raw JSON (development only)
  return (
    <pre className="text-sm bg-muted/30 p-4 rounded-xl overflow-auto">
      {JSON.stringify(content, null, 2)}
    </pre>
  );
}
