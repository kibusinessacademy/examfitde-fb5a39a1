import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const CoursesList = lazy(() => import('@/pages/admin/CoursesList'));
const CourseCreate = lazy(() => import('@/pages/admin/CourseCreate'));
const CourseEdit = lazy(() => import('@/pages/admin/CourseEdit'));
const QuestionsList = lazy(() => import('@/pages/admin/QuestionsList'));
const ExamBlueprintsPage = lazy(() => import('@/pages/admin/ExamBlueprintsPage'));
const CourseHealthPage = lazy(() => import('@/pages/admin/CourseHealthPage'));
const WorkflowStudioPage = lazy(() => import('@/pages/admin/WorkflowStudioPage'));
const QualityGatesPage = lazy(() => import('@/pages/admin/QualityGatesPage'));
const MarketingCouncilPage = lazy(() => import('@/pages/admin/MarketingCouncilPage'));
const AssessmentCouncilPage = lazy(() => import('@/pages/admin/AssessmentCouncilPage'));
const TutorCouncilPage = lazy(() => import('@/pages/admin/TutorCouncilPage'));

const Loading = () => (
  <div className="flex items-center justify-center py-16">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const tabs = [
  { path: '/admin/content/courses', label: 'Kurse' },
  { path: '/admin/content/questions', label: 'Prüfungsfragen' },
  { path: '/admin/content/blueprints', label: 'Blueprints' },
  { path: '/admin/content/health', label: 'Kurs-Health' },
  { path: '/admin/content/workflows', label: 'Workflows' },
  { path: '/admin/content/quality-gates', label: 'Quality Gates' },
  { path: '/admin/content/marketing', label: 'Marketing Council' },
  { path: '/admin/content/assessment', label: 'Assessment Council' },
  { path: '/admin/content/tutor', label: 'Tutor Council' },
];

export default function ContentPage() {
  const location = useLocation();
  const activeTab = tabs.find(t => location.pathname.startsWith(t.path))?.path || tabs[0].path;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Content & Learning</h1>
        <p className="text-sm text-muted-foreground">Kurse, Lektionen, Prüfungsfragen & Qualität</p>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-border pb-px min-w-max">
          {tabs.map(tab => (
            <Link
              key={tab.path}
              to={tab.path}
              className={cn(
                "px-3 py-2 text-sm rounded-t-md transition-colors",
                activeTab === tab.path
                  ? "bg-primary/10 text-primary font-medium border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<Navigate to="courses" replace />} />
          <Route path="courses" element={<CoursesList />} />
          <Route path="courses/new" element={<CourseCreate />} />
          <Route path="courses/:courseId/edit" element={<CourseEdit />} />
          <Route path="questions" element={<QuestionsList />} />
          <Route path="blueprints" element={<ExamBlueprintsPage />} />
          <Route path="health" element={<CourseHealthPage />} />
          <Route path="workflows" element={<WorkflowStudioPage />} />
          <Route path="quality-gates" element={<QualityGatesPage />} />
          <Route path="marketing" element={<MarketingCouncilPage />} />
          <Route path="assessment" element={<AssessmentCouncilPage />} />
          <Route path="tutor/*" element={<TutorCouncilPage />} />
        </Routes>
      </Suspense>
    </div>
  );
}
