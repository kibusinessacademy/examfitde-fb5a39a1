import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

// Guards & Layouts
import MainLayout from '@/components/layout/MainLayout';
import AdminV4Layout from '@/components/layout/AdminV4Layout';
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

// Admin V4 Module Pages
const CommandPage = lazy(() => import('@/pages/admin/v4/CommandPage'));
const StudioPage = lazy(() => import('@/pages/admin/v4/StudioPage'));
const QualityPage = lazy(() => import('@/pages/admin/v4/QualityPage'));
const OpsPage = lazy(() => import('@/pages/admin/v4/OpsPage'));
const BusinessPage = lazy(() => import('@/pages/admin/v4/BusinessPage'));
const GrowthPage = lazy(() => import('@/pages/admin/v4/GrowthPage'));
const ScalePage = lazy(() => import('@/pages/admin/v4/ScalePage'));
const PipelineMonitorPage = lazy(() => import('@/pages/admin/v4/PipelineMonitorPage'));
const LoadControlPage = lazy(() => import('@/pages/admin/v4/LoadControlPage'));
const ReviewInboxPage = lazy(() => import('@/pages/admin/v4/ReviewInboxPage'));

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

        {/* ====== ADMIN V4 ====== */}
        <Route path="/admin" element={<AdminV4Layout />}>
          <Route index element={<Navigate to="command" replace />} />
          <Route path="command" element={<CommandPage />} />
          <Route path="studio/*" element={<StudioPage />} />
          <Route path="quality/*" element={<QualityPage />} />
          <Route path="ops/*" element={<OpsPage />} />
          <Route path="business/*" element={<BusinessPage />} />
          <Route path="growth/*" element={<GrowthPage />} />
          <Route path="scale/*" element={<ScalePage />} />
          <Route path="pipeline" element={<PipelineMonitorPage />} />
          <Route path="load-control" element={<LoadControlPage />} />
        </Route>

        {/* Legacy redirects → V4 */}
        <Route path="/admin/dashboard" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/courses" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/course-studio" element={<Navigate to="/admin/studio/new" replace />} />
        <Route path="/admin/course/:packageId" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/jobs" element={<Navigate to="/admin/ops" replace />} />
        <Route path="/admin/jobs/*" element={<Navigate to="/admin/ops" replace />} />
        <Route path="/admin/system/*" element={<Navigate to="/admin/ops" replace />} />
        <Route path="/admin/finance/*" element={<Navigate to="/admin/business" replace />} />
        <Route path="/admin/content/*" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/curriculum/*" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/council/*" element={<Navigate to="/admin/quality" replace />} />
        <Route path="/admin-v2/*" element={<Navigate to="/admin/command" replace />} />

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

export default AppRoutes;
