import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const CurriculaList = lazy(() => import('@/pages/admin/CurriculaList'));
const CurriculumImport = lazy(() => import('@/pages/admin/CurriculumImport'));
const CurriculumDetail = lazy(() => import('@/pages/admin/CurriculumDetail'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

export default function CurriculumPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Curriculum (SSOT)</h1>
        <p className="text-sm text-muted-foreground">Rahmenlehrpläne, Lernfelder & Kompetenzen – nach Freeze read-only</p>
      </div>

      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<CurriculaList />} />
          <Route path="new" element={<CurriculumImport />} />
          <Route path=":curriculumId" element={<CurriculumDetail />} />
        </Routes>
      </Suspense>
    </div>
  );
}
