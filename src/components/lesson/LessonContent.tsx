import { lazy, Suspense } from 'react';
import { Loader2, BookOpen, ClipboardCheck, PlayCircle } from 'lucide-react';
import type { Json } from '@/integrations/supabase/types';

const H5PPlayer = lazy(() => import('./H5PPlayer'));

interface LessonContentProps {
  content: Json | null;
  h5pContentId: string | null;
  onH5PCompleted?: (score?: number, maxScore?: number) => void;
  onH5PProgress?: (progress: number) => void;
}

interface ContentData {
  type?: string;
  html?: string;
  h5pContentId?: string;
  [key: string]: unknown;
}

export default function LessonContent({ 
  content, 
  h5pContentId,
  onH5PCompleted,
  onH5PProgress 
}: LessonContentProps) {
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
    return (
      <div className="text-center py-12">
        <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-medium mb-2">Inhalte werden erstellt</h3>
        <p className="text-muted-foreground max-w-md mx-auto">
          Die Lerninhalte für diese Lektion werden noch von der KI generiert. 
          Bitte schauen Sie später wieder vorbei.
        </p>
      </div>
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
    return (
      <div className="space-y-4">
        <div 
          className="prose prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: String(contentData.html) }} 
        />
      </div>
    );
  }

  // Quiz placeholder
  if (contentData.type === 'quiz') {
    return (
      <div className="space-y-6">
        <h3 className="text-lg font-semibold">Wissensüberprüfung</h3>
        <p className="text-muted-foreground">
          Beantworten Sie die folgenden Fragen, um Ihr Verständnis zu testen.
        </p>
        <div className="p-6 bg-muted/30 rounded-xl text-center">
          <ClipboardCheck className="h-12 w-12 text-primary mx-auto mb-3" />
          <p>Quiz-Komponente wird geladen...</p>
        </div>
      </div>
    );
  }

  // H5P placeholder (when type is h5p but no contentId yet)
  if (contentData.type === 'h5p') {
    return (
      <div className="aspect-video bg-muted rounded-xl flex items-center justify-center">
        <div className="text-center">
          <PlayCircle className="h-16 w-16 text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">H5P-Inhalt wird vorbereitet...</p>
        </div>
      </div>
    );
  }

  // Fallback: show raw JSON
  return (
    <pre className="text-sm bg-muted/30 p-4 rounded-xl overflow-auto">
      {JSON.stringify(content, null, 2)}
    </pre>
  );
}
