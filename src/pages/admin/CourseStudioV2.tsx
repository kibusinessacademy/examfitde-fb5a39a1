import { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';

const CourseStudioPage = lazy(() => import('./CourseStudioPage'));

export default function CourseStudioV2() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
      <CourseStudioPage />
    </Suspense>
  );
}
