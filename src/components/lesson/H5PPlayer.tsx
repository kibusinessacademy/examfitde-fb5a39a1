import { useEffect, useRef, useState } from 'react';
import { getProtectedAssetUrl } from '@/lib/storageAccess';
import { Loader2, AlertCircle, PlayCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { trackH5P } from '@/lib/gtm';

interface H5PPlayerProps {
  contentId: string;
  curriculumId?: string;
  onCompleted?: (score?: number, maxScore?: number) => void;
  onProgress?: (progress: number) => void;
}

interface XAPIStatement {
  verb?: {
    id?: string;
  };
  result?: {
    score?: {
      raw?: number;
      max?: number;
      scaled?: number;
    };
    completion?: boolean;
    success?: boolean;
  };
}

export default function H5PPlayer({ contentId, curriculumId, onCompleted, onProgress }: H5PPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const h5pInstanceRef = useRef<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contentUrl, setContentUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchContentUrl = async () => {
      try {
        // Get a signed URL for the H5P content folder via entitlement-gated edge function
        const signedUrl = await getProtectedAssetUrl({
          bucket: 'h5p-content',
          path: `${contentId}/content.json`,
          curriculumId,
          expiresIn: 300,
        });

        if (signedUrl) {
          // The base path for the H5P content folder
          const basePath = signedUrl.replace('/content.json', '');
          setContentUrl(basePath);
        } else {
          setError('H5P-Inhalt nicht gefunden');
        }
      } catch (err) {
        console.error('Error fetching H5P content:', err);
        setError('Fehler beim Laden des H5P-Inhalts');
      }
    };

    fetchContentUrl();
  }, [contentId, curriculumId]);

  useEffect(() => {
    if (!contentUrl || !containerRef.current) return;

    const initH5P = async () => {
      try {
        setLoading(true);
        
        // Dynamically import h5p-standalone
        const { H5P } = await import('h5p-standalone');
        
        // Clear any previous content
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
        }

        // Initialize H5P player with CDN assets
        const h5pInstance = new H5P(containerRef.current, {
          h5pJsonPath: contentUrl,
          frameJs: 'https://unpkg.com/h5p-standalone@3.8.0/dist/frame.bundle.js',
          frameCss: 'https://unpkg.com/h5p-standalone@3.8.0/dist/styles/h5p.css',
        });

        h5pInstanceRef.current = h5pInstance;

        // GA4: H5P start
        trackH5P('h5p_started', { contentId, curriculumId });

        // Listen for xAPI events
        if (typeof window !== 'undefined') {
          window.addEventListener('message', handleXAPIMessage);
        }

        setLoading(false);
      } catch (err) {
        console.error('Error initializing H5P:', err);
        setError('Fehler beim Initialisieren des H5P-Players');
        setLoading(false);
      }
    };

    initH5P();

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('message', handleXAPIMessage);
      }
    };
  }, [contentUrl]);

  const handleXAPIMessage = (event: MessageEvent) => {
    // Handle xAPI statements from H5P content
    if (event.data?.context === 'h5p' && event.data?.statement) {
      const statement = event.data.statement as XAPIStatement;
      const verbId = statement.verb?.id ?? '';
      const score = statement.result?.score?.raw ?? null;
      const maxScore = statement.result?.score?.max ?? null;
      const scaled = statement.result?.score?.scaled;
      const progressPct = scaled !== undefined ? Math.round(scaled * 100) : null;

      // GA4: per-answer event
      if (verbId.includes('answered')) {
        trackH5P('h5p_answered', {
          contentId,
          curriculumId,
          score,
          maxScore,
          progressPct,
          success: statement.result?.success ?? null,
        });
      }

      if (verbId.includes('completed') || verbId.includes('answered')) {
        if (statement.result?.completion) {
          trackH5P('h5p_completed', {
            contentId,
            curriculumId,
            score,
            maxScore,
            progressPct,
            success: statement.result?.success ?? null,
          });
          onCompleted?.(score ?? undefined, maxScore ?? undefined);
        }

        if (scaled !== undefined) {
          trackH5P('h5p_progress', { contentId, curriculumId, progressPct });
          onProgress?.(scaled * 100);
        }
      }
    }
  };

  if (error) {
    return (
      <Card className="glass-card">
        <CardContent className="p-8 text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">Inhalt nicht verfügbar</h3>
          <p className="text-muted-foreground mb-4">{error}</p>
          <p className="text-sm text-muted-foreground">
            Content ID: {contentId}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="relative w-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10 rounded-xl">
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">H5P-Inhalt wird geladen...</p>
          </div>
        </div>
      )}
      <div 
        ref={containerRef} 
        className="h5p-container w-full min-h-[400px] rounded-xl overflow-hidden bg-muted/30"
      />
    </div>
  );
}
