import { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, Link as LinkIcon, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

type Check = { key: string; ok: boolean; detail?: string };

export default function AdminH5PUploadPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [contentId, setContentId] = useState<string>('');
  const [lessonId, setLessonId] = useState('');
  const [linking, setLinking] = useState(false);
  const [lastUpload, setLastUpload] = useState<{ contentId: string; title: string | null; files: number } | null>(null);
  const [validation, setValidation] = useState<{ checks: Check[]; passed: boolean } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    setValidation(null); setErrorMsg(null);
    if (!file) { toast.error('Bitte eine .h5p-Datei wählen'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data, error } = await supabase.functions.invoke('upload-h5p-package', { body: fd });
      // Edge function returns structured JSON even on validation failure (non-2xx).
      // supabase-js surfaces non-2xx via `error`; the body still arrives in `data` for FunctionsHttpError.
      const body = (data ?? (error as any)?.context?.json ?? null) as
        | { ok: boolean; content_id?: string; file_count?: number; title?: string | null; error?: string; validation?: { checks: Check[]; passed: boolean } }
        | null;
      if (body?.validation) setValidation(body.validation);
      if (error || !body?.ok) {
        const msg = body?.error ?? (error instanceof Error ? error.message : 'Upload fehlgeschlagen');
        setErrorMsg(msg);
        toast.error(msg);
        return;
      }
      setContentId(body.content_id!);
      setLastUpload({ contentId: body.content_id!, title: body.title ?? null, files: body.file_count ?? 0 });
      toast.success(`Hochgeladen: ${body.file_count} Dateien`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload fehlgeschlagen';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleLink = async () => {
    if (!contentId || !lessonId) { toast.error('content_id und lesson_id erforderlich'); return; }
    setLinking(true);
    try {
      const { error } = await supabase.rpc('admin_link_h5p_to_lesson', {
        p_lesson_id: lessonId,
        p_content_id: contentId,
      });
      if (error) throw error;
      toast.success('Lesson verknüpft');
      setLessonId('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verknüpfung fehlgeschlagen');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">H5P-Inhalte verwalten</h1>
        <p className="text-sm text-text-secondary mt-1">
          Lade ein <code>.h5p</code> Paket hoch (entpackt automatisch in den privaten <code>h5p-content</code> Bucket)
          und verknüpfe es mit einer Lesson-ID.
        </p>
      </header>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> 1. Paket hochladen</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input ref={fileRef} type="file" accept=".h5p,application/zip" />
          <Button onClick={handleUpload} disabled={uploading} className="w-full sm:w-auto">
            {uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Lädt hoch…</> : <>Hochladen & entpacken</>}
          </Button>
          {lastUpload && (
            <div className="rounded-md border border-border bg-surface-sunken p-3 text-sm flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-text-secondary mt-0.5" />
              <div className="min-w-0">
                <div className="font-medium text-text-primary">{lastUpload.title ?? 'H5P-Paket'}</div>
                <div className="text-xs text-text-muted break-all">content_id: <code>{lastUpload.contentId}</code></div>
                <div className="text-xs text-text-muted">{lastUpload.files} Dateien</div>
              </div>
            </div>
          )}
          {(validation || errorMsg) && (
            <div className="rounded-md border border-border p-3 text-sm space-y-2">
              <div className="font-medium text-text-primary">
                {validation?.passed ? '✓ Validierung bestanden' : 'Validierung'}
                {errorMsg && <span className="ml-2 text-text-secondary">— {errorMsg}</span>}
              </div>
              {validation && (
                <ul className="space-y-1">
                  {validation.checks.map((c) => (
                    <li key={c.key} className="flex items-start gap-2 text-xs">
                      {c.ok
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-text-secondary mt-0.5 shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: 'hsl(var(--destructive))' }} />}
                      <span className={c.ok ? 'text-text-secondary' : 'text-text-primary font-medium'}>
                        <code>{c.key}</code>{c.detail ? ` — ${c.detail}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><LinkIcon className="h-4 w-4" /> 2. An Lesson verknüpfen</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cid">H5P content_id</Label>
            <Input id="cid" value={contentId} onChange={(e) => setContentId(e.target.value)} placeholder="h5p_…" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lid">Lesson UUID</Label>
            <Input id="lid" value={lessonId} onChange={(e) => setLessonId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
          </div>
          <Button onClick={handleLink} disabled={linking || !contentId || !lessonId} className="w-full sm:w-auto">
            {linking ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verknüpfe…</> : 'Verknüpfen'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
