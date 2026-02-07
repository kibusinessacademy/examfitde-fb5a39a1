import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

// Guards & Layouts
import MainLayout from '@/components/layout/MainLayout';
import AdminLayout from '@/components/layout/AdminLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';

// Lazy Loaded Pages
const HomePage = lazy(() => import('@/pages/HomePage'));
const CoursesPage = lazy(() => import('@/pages/CoursesPage'));
const CourseDetailPage = lazy(() => import('@/pages/CourseDetailPage'));
const LearnerDashboard = lazy(() => import('@/pages/LearnerDashboard'));
const ExamTrainer = lazy(() => import('@/pages/ExamTrainer'));
const Auth = lazy(() => import('@/pages/Auth'));
const NotFound = lazy(() => import('@/pages/NotFound'));

// Admin Pages
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const CurriculaList = lazy(() => import('@/pages/admin/CurriculaList'));
const CurriculumImport = lazy(() => import('@/pages/admin/CurriculumImport'));
const CurriculumDetail = lazy(() => import('@/pages/admin/CurriculumDetail'));
const CoursesList = lazy(() => import('@/pages/admin/CoursesList'));
const CourseCreate = lazy(() => import('@/pages/admin/CourseCreate'));
const CourseEdit = lazy(() => import('@/pages/admin/CourseEdit'));
const QuestionsList = lazy(() => import('@/pages/admin/QuestionsList'));

// Learner Pages
const LessonPlayer = lazy(() => import('@/pages/LessonPlayer'));

const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const AppRoutes = () => {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Public Routes */}
        <Route path="/auth" element={<Auth />} />
        
        {/* Main Layout Routes */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/course/:slug" element={<CourseDetailPage />} />
          
          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<LearnerDashboard />} />
            <Route path="/exam-trainer" element={<ExamTrainer />} />
            <Route path="/lesson/:lessonId" element={<LessonPlayer />} />
          </Route>
        </Route>

        {/* Admin V2 Routes */}
        <Route path="/admin-v2" element={<AdminLayout />}>
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="curricula" element={<CurriculaList />} />
          <Route path="curricula/new" element={<CurriculumImport />} />
          <Route path="curricula/:curriculumId" element={<CurriculumDetail />} />
          <Route path="courses" element={<CoursesList />} />
          <Route path="courses/new" element={<CourseCreate />} />
          <Route path="courses/:courseId/edit" element={<CourseEdit />} />
          <Route path="questions" element={<QuestionsList />} />
        </Route>

        {/* Admin Redirects */}
        <Route path="/admin" element={<Navigate to="/admin-v2/dashboard" replace />} />
        <Route path="/admin/*" element={<Navigate to="/admin-v2/dashboard" replace />} />

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

export default AppRoutes;
