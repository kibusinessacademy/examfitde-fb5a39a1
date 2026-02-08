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
const ResetPassword = lazy(() => import('@/pages/auth/ResetPassword'));
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
const ExamBlueprintsPage = lazy(() => import('@/pages/admin/ExamBlueprintsPage'));
const BlueprintTemplatesPage = lazy(() => import('@/pages/admin/BlueprintTemplatesPage'));

// Job Admin Pages
const JobsDashboard = lazy(() => import('@/pages/admin/JobsDashboard'));
const JobsList = lazy(() => import('@/pages/admin/JobsList'));
const JobDetail = lazy(() => import('@/pages/admin/JobDetail'));
const JobDeadLetter = lazy(() => import('@/pages/admin/JobDeadLetter'));

// AI Worker Governance
const AIWorkersPage = lazy(() => import('@/pages/admin/AIWorkersPage'));

// AZAV Audit Exports
const AuditExportsPage = lazy(() => import('@/pages/admin/AuditExportsPage'));

// Evidence Packs
const EvidencePacksPage = lazy(() => import('@/pages/admin/EvidencePacksPage'));

// Business Intelligence & Operations
const KPIDashboard = lazy(() => import('@/pages/admin/KPIDashboard'));
const MarketingHub = lazy(() => import('@/pages/admin/MarketingHub'));
const CRMPage = lazy(() => import('@/pages/admin/CRMPage'));
const SystemHealthPage = lazy(() => import('@/pages/admin/SystemHealthPage'));
const SystemAuditPage = lazy(() => import('@/pages/admin/SystemAuditPage'));
const SEOPage = lazy(() => import('@/pages/admin/SEOPage'));

// AZAV Compliance
const AZAVCompliancePage = lazy(() => import('@/pages/admin/AZAVCompliancePage'));

// Documentation
const DocumentationPage = lazy(() => import('@/pages/admin/DocumentationPage'));

// BIBB Seeding
const BIBBSeedingPage = lazy(() => import('@/pages/admin/BIBBSeedingPage'));

// Learner Pages
const LessonPlayer = lazy(() => import('@/pages/LessonPlayer'));
const ExamSimulation = lazy(() => import('@/pages/ExamSimulation'));
const ExamResultsPage = lazy(() => import('@/pages/ExamResultsPage'));
const OralExamTrainer = lazy(() => import('@/pages/OralExamTrainer'));

// Enhanced Learning Pages
const SpacedRepetitionSession = lazy(() => import('@/pages/SpacedRepetitionSession'));
const ExamAnxietyManager = lazy(() => import('@/pages/ExamAnxietyManager'));
const VARKLerntypTest = lazy(() => import('@/pages/VARKLerntypTest'));

// Shop Pages
const ShopPage = lazy(() => import('@/pages/ShopPage'));
const PurchaseSuccessPage = lazy(() => import('@/pages/PurchaseSuccessPage'));

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
        <Route path="/auth/reset-password" element={<ResetPassword />} />
        
        {/* Shop Routes (standalone, not in MainLayout) */}
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/purchase-success" element={<PurchaseSuccessPage />} />
        
        {/* Main Layout Routes */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/course/:slug" element={<CourseDetailPage />} />
          
          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<LearnerDashboard />} />
            <Route path="/exam-trainer" element={<ExamTrainer />} />
            <Route path="/oral-exam" element={<OralExamTrainer />} />
            <Route path="/exam-simulation" element={<ExamSimulation />} />
            <Route path="/exam-simulation/:sessionId" element={<ExamSimulation />} />
            <Route path="/exam-results/:sessionId" element={<ExamResultsPage />} />
            <Route path="/lesson/:lessonId" element={<LessonPlayer />} />
            {/* Enhanced Learning Routes */}
            <Route path="/spaced-repetition" element={<SpacedRepetitionSession />} />
            <Route path="/exam-anxiety" element={<ExamAnxietyManager />} />
            <Route path="/vark-test" element={<VARKLerntypTest />} />
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
          <Route path="exam-blueprints" element={<ExamBlueprintsPage />} />
          <Route path="blueprint-templates" element={<BlueprintTemplatesPage />} />
          {/* Job Control Center */}
          <Route path="jobs/dashboard" element={<JobsDashboard />} />
          <Route path="jobs" element={<JobsList />} />
          <Route path="jobs/deadletter" element={<JobDeadLetter />} />
          <Route path="jobs/:jobId" element={<JobDetail />} />
          {/* AI Worker Governance */}
          <Route path="ai-workers" element={<AIWorkersPage />} />
          {/* AZAV Audit Exports */}
          <Route path="audit-exports" element={<AuditExportsPage />} />
          {/* Evidence Packs */}
          <Route path="evidence-packs" element={<EvidencePacksPage />} />
          {/* Business Intelligence & Operations */}
          <Route path="kpi-dashboard" element={<KPIDashboard />} />
          <Route path="marketing" element={<MarketingHub />} />
          <Route path="crm" element={<CRMPage />} />
          <Route path="system-health" element={<SystemHealthPage />} />
          <Route path="system-audit" element={<SystemAuditPage />} />
          <Route path="seo" element={<SEOPage />} />
          {/* AZAV Compliance */}
          <Route path="azav-compliance" element={<AZAVCompliancePage />} />
          {/* Documentation */}
          <Route path="documentation" element={<DocumentationPage />} />
          {/* BIBB Seeding */}
          <Route path="bibb-seeding" element={<BIBBSeedingPage />} />
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
