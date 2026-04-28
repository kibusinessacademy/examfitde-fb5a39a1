import { useParams } from "react-router-dom";
import { SEOHead } from "@/components/seo/SEOHead";
import { SITE_URL } from "@/lib/seo";
import LeadQuizRunner from "@/components/quiz/LeadQuizRunner";
import { useLeadQuiz } from "@/hooks/useLeadQuiz";

export default function LeadQuizPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: quiz } = useLeadQuiz(slug);

  const title = quiz?.title ?? "Selbsttest";
  const description =
    quiz?.description ??
    "Kostenloser Selbsttest mit persönlichem Lernplan für deine Prüfungsvorbereitung.";

  return (
    <>
      <SEOHead
        title={`${title} – ExamFit`}
        description={description}
        canonical={`${SITE_URL}/quiz/${slug}`}
      />
      <main className="container mx-auto px-4 py-10 md:py-16">
        <header className="text-center mb-8 max-w-2xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">{title}</h1>
          {quiz?.subtitle && (
            <p className="text-lg text-muted-foreground">{quiz.subtitle}</p>
          )}
        </header>
        {slug && <LeadQuizRunner slug={slug} />}
      </main>
    </>
  );
}
