import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const CoursePackagesList = lazy(() => import('@/pages/admin/CoursePackagesList'));
const CourseStudioPage = lazy(() => import('@/pages/admin/CourseStudioPage'));
const CourseWorkspace = lazy(() => import('@/pages/admin/CourseWorkspace'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

export default function StudioPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route index element={<CoursePackagesList />} />
        <Route path="new" element={<CourseStudioPage />} />
        <Route path=":packageId" element={<CourseWorkspace />} />
      </Routes>
    </Suspense>
  );
}
