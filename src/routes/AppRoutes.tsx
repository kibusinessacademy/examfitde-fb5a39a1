import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

// Guards & Layouts
import MainLayout from '@/components/layout/MainLayout';
import AdminV3Layout from '@/components/layout/AdminV3Layout';
import SEOLayout from '@/components/layout/SEOLayout';
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
const InstallPage = lazy(() => import('@/pages/InstallPage'));

// SEO Pages
const IHKPruefungenPage = lazy(() => import('@/pages/seo/IHKPruefungenPage'));
const PruefungstrainingAzubisPage = lazy(() => import('@/pages/seo/PruefungstrainingAzubisPage'));
const PruefungstrainingBetriebePage = lazy(() => import('@/pages/seo/PruefungstrainingBetriebePage'));
const PruefungstrainingInstitutionenPage = lazy(() => import('@/pages/seo/PruefungstrainingInstitutionenPage'));
const BerufePage = lazy(() => import('@/pages/seo/BerufePage'));
const BerufDetailPage = lazy(() => import('@/pages/seo/BerufDetailPage'));
const UnternehmenPage = lazy(() => import('@/pages/seo/UnternehmenPage'));
const PreisePage = lazy(() => import('@/pages/seo/PreisePage'));
const ProductListPage = lazy(() => import('@/pages/seo/ProductListPage'));
const LernkurseListPage = lazy(() => import('@/pages/seo/ProductListPage').then(m => ({ default: m.LernkurseListPage })));
const PruefungstrainerListPage = lazy(() => import('@/pages/seo/ProductListPage').then(m => ({ default: m.PruefungstrainerListPage })));
const BundleListPage = lazy(() => import('@/pages/seo/ProductListPage').then(m => ({ default: m.BundleListPage })));
const LernkursDetailPage = lazy(() => import('@/pages/seo/ProductDetailPage').then(m => ({ default: m.LernkursDetailPage })));
const PruefungstrainerDetailPage = lazy(() => import('@/pages/seo/ProductDetailPage').then(m => ({ default: m.PruefungstrainerDetailPage })));
const BundleDetailPage = lazy(() => import('@/pages/seo/ProductDetailPage').then(m => ({ default: m.BundleDetailPage })));
const WissenPage = lazy(() => import('@/pages/seo/WissenPage'));
const WissenArticlePage = lazy(() => import('@/pages/seo/WissenArticlePage'));
const WissenAllePage = lazy(() => import('@/pages/seo/WissenAllePage'));
const SearchPage = lazy(() => import('@/pages/seo/SearchPage'));

// Legal Pages
const AGBPage = lazy(() => import('@/pages/seo/AGBPage'));
const FAQPage = lazy(() => import('@/pages/seo/FAQPage'));
const DatenschutzPage = lazy(() => import('@/pages/seo/DatenschutzPage'));
const ImpressumPage = lazy(() => import('@/pages/seo/ImpressumPage'));

// Admin V3 Module Pages
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const ContentPage = lazy(() => import('@/pages/admin/ContentPage'));
const CurriculumPage = lazy(() => import('@/pages/admin/CurriculumPage'));
const CouncilPageV3 = lazy(() => import('@/pages/admin/CouncilPage_V3'));
const SystemPage = lazy(() => import('@/pages/admin/SystemPage'));
const FinancePage = lazy(() => import('@/pages/admin/FinancePage'));
const CourseStudioPage = lazy(() => import('@/pages/admin/CourseStudioPage'));
const CourseStudioV2 = lazy(() => import('@/pages/admin/CourseStudioV2'));

// Learner Pages
const LessonPlayer = lazy(() => import('@/pages/LessonPlayer'));
const ExamSimulation = lazy(() => import('@/pages/ExamSimulation'));
const ExamResultsPage = lazy(() => import('@/pages/ExamResultsPage'));
const OralExamTrainer = lazy(() => import('@/pages/OralExamTrainer'));

// Enhanced Learning Pages
const SpacedRepetitionSession = lazy(() => import('@/pages/SpacedRepetitionSession'));
const ExamAnxietyManager = lazy(() => import('@/pages/ExamAnxietyManager'));
const VARKLerntypTest = lazy(() => import('@/pages/VARKLerntypTest'));
const DiagnosticTest = lazy(() => import('@/pages/DiagnosticTest'));

// Shop Pages
const ShopPage = lazy(() => import('@/pages/ShopPage'));
const PurchaseSuccessPage = lazy(() => import('@/pages/PurchaseSuccessPage'));

// Handbook Pages
const HandbookPage = lazy(() => import('@/pages/HandbookPage'));
const HandbookChapterPage = lazy(() => import('@/pages/HandbookChapterPage'));
const HandbookLandingPage = lazy(() => import('@/pages/seo/HandbookLandingPage'));

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
        <Route path="/installieren" element={<InstallPage />} />
        
        {/* Shop Routes */}
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/purchase-success" element={<PurchaseSuccessPage />} />

        {/* SEO Routes */}
        <Route element={<SEOLayout />}>
          <Route path="/ihk-pruefungen" element={<IHKPruefungenPage />} />
          <Route path="/pruefungstraining-azubis" element={<PruefungstrainingAzubisPage />} />
          <Route path="/pruefungstraining-betriebe" element={<PruefungstrainingBetriebePage />} />
          <Route path="/pruefungstraining-institutionen" element={<PruefungstrainingInstitutionenPage />} />
          <Route path="/ihk-pruefungen/:slug" element={<BerufDetailPage />} />
          <Route path="/berufe" element={<BerufePage />} />
          <Route path="/berufe/:slug" element={<BerufDetailPage />} />
          <Route path="/pruefungstraining" element={<ProductListPage />} />
          <Route path="/lernkurse" element={<LernkurseListPage />} />
          <Route path="/lernkurse/:slug" element={<LernkursDetailPage />} />
          <Route path="/pruefungstrainer" element={<PruefungstrainerListPage />} />
          <Route path="/pruefungstrainer/:slug" element={<PruefungstrainerDetailPage />} />
          <Route path="/bundle" element={<BundleListPage />} />
          <Route path="/bundle/:slug" element={<BundleDetailPage />} />
          <Route path="/unternehmen" element={<UnternehmenPage />} />
          <Route path="/preise" element={<PreisePage />} />
          <Route path="/pruefungshandbuch" element={<HandbookLandingPage />} />
          <Route path="/wissen" element={<WissenPage />} />
          <Route path="/wissen/alle" element={<WissenAllePage />} />
          <Route path="/suche" element={<SearchPage />} />
          <Route path="/agb" element={<AGBPage />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/datenschutz" element={<DatenschutzPage />} />
          <Route path="/impressum" element={<ImpressumPage />} />
          <Route path="/wissen/:slug" element={<WissenArticlePage />} />
        </Route>
        
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
            <Route path="/spaced-repetition" element={<SpacedRepetitionSession />} />
            <Route path="/exam-anxiety" element={<ExamAnxietyManager />} />
            <Route path="/vark-test" element={<VARKLerntypTest />} />
            <Route path="/diagnostic/:curriculumId" element={<DiagnosticTest />} />
            <Route path="/handbuch" element={<HandbookPage />} />
            <Route path="/handbuch/:chapterKey" element={<HandbookChapterPage />} />
          </Route>
        </Route>

        {/* ====== ADMIN V3 ====== */}
        <Route path="/admin" element={<AdminV3Layout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="course-studio" element={<CourseStudioPage />} />
          <Route path="studio" element={<CourseStudioV2 />} />
          <Route path="content/*" element={<ContentPage />} />
          <Route path="curriculum/*" element={<CurriculumPage />} />
          <Route path="council/*" element={<CouncilPageV3 />} />
          <Route path="system/*" element={<SystemPage />} />
          <Route path="finance/*" element={<FinancePage />} />
        </Route>

        {/* Legacy admin-v2 redirects */}
        <Route path="/admin-v2" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin-v2/dashboard" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin-v2/courses" element={<Navigate to="/admin/content/courses" replace />} />
        <Route path="/admin-v2/courses/*" element={<Navigate to="/admin/content/courses" replace />} />
        <Route path="/admin-v2/curricula" element={<Navigate to="/admin/curriculum" replace />} />
        <Route path="/admin-v2/curricula/*" element={<Navigate to="/admin/curriculum" replace />} />
        <Route path="/admin-v2/questions" element={<Navigate to="/admin/content/questions" replace />} />
        <Route path="/admin-v2/exam-blueprints" element={<Navigate to="/admin/content/blueprints" replace />} />
        <Route path="/admin-v2/council-control" element={<Navigate to="/admin/council/control" replace />} />
        <Route path="/admin-v2/council/*" element={<Navigate to="/admin/council" replace />} />
        <Route path="/admin-v2/jobs/*" element={<Navigate to="/admin/system/jobs" replace />} />
        <Route path="/admin-v2/system-health" element={<Navigate to="/admin/system/health" replace />} />
        <Route path="/admin-v2/operations" element={<Navigate to="/admin/system/operations" replace />} />
        <Route path="/admin-v2/ai-workers" element={<Navigate to="/admin/system/ai-workers" replace />} />
        <Route path="/admin-v2/finance" element={<Navigate to="/admin/finance/overview" replace />} />
        <Route path="/admin-v2/enterprise-seats" element={<Navigate to="/admin/finance/licenses" replace />} />
        <Route path="/admin-v2/azav-compliance" element={<Navigate to="/admin/finance/compliance" replace />} />
        <Route path="/admin-v2/audit-exports" element={<Navigate to="/admin/finance/exports" replace />} />
        <Route path="/admin-v2/workflows" element={<Navigate to="/admin/content/workflows" replace />} />
        <Route path="/admin-v2/course-health" element={<Navigate to="/admin/content/health" replace />} />
        <Route path="/admin-v2/quality-gates" element={<Navigate to="/admin/content/quality-gates" replace />} />
        <Route path="/admin-v2/qc-dashboard" element={<Navigate to="/admin/council/quality" replace />} />
        <Route path="/admin-v2/early-warnings" element={<Navigate to="/admin/system/warnings" replace />} />
        <Route path="/admin-v2/patches" element={<Navigate to="/admin/system/patches" replace />} />
        <Route path="/admin-v2/*" element={<Navigate to="/admin/dashboard" replace />} />

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

export default AppRoutes;
