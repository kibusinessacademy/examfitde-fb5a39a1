import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  GraduationCap,
  Building2,
  ExternalLink,
  Eye,
  ShoppingCart,
  BookOpen,
  FileQuestion,
  Brain,
  Sparkles,
  LayoutDashboard,
  Shield,
  Users,
  CreditCard,
  BarChart3,
  Globe,
  Megaphone,
  Home,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type PreviewMode = "standard" | "premium" | "adaptive";

function previewUrl(path: string, mode: PreviewMode) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}admin_preview=1&preview_mode=${mode}`;
}

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function LinkButton({
  href,
  icon: Icon,
  children,
  variant = "outline",
}: {
  href: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  variant?: "outline" | "default";
}) {
  return (
    <Button
      variant={variant}
      size="sm"
      className="justify-start gap-2"
      onClick={() => window.open(href, "_blank")}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
      <ExternalLink className="h-3 w-3 ml-auto shrink-0 opacity-50" />
    </Button>
  );
}

/* ─── Learner Tab ─── */
function LearnerTestTab({ previewMode }: { previewMode: PreviewMode }) {
  const { data: courses = [], isLoading } = useQuery({
    queryKey: ["admin-test-published-courses"],
    queryFn: async () => {
      const { data } = await supabase
        .from("v_admin_published_course_preview" as any)
        .select("curriculum_id, title, approved_questions, lessons_count, tutor_index_count")
        .order("title");
      return (data ?? []) as unknown as {
        curriculum_id: string;
        title: string;
        approved_questions: number;
        lessons_count: number;
        tutor_index_count: number;
      }[];
    },
    staleTime: 120_000,
  });

  return (
    <div className="space-y-6">
      {/* General Learner Pages */}
      <SectionCard
        title="Allgemeine Seiten"
        description="Landing Pages, Shop, Navigation — so wie ein neuer Besucher sie sieht"
        icon={Globe}
      >
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
          <LinkButton href={previewUrl("/", previewMode)} icon={Home}>Startseite</LinkButton>
          <LinkButton href={previewUrl("/shop", previewMode)} icon={ShoppingCart}>Shop</LinkButton>
          <LinkButton href={previewUrl("/courses", previewMode)} icon={BookOpen}>Kursübersicht</LinkButton>
          <LinkButton href={previewUrl("/preise", previewMode)} icon={CreditCard}>Preise</LinkButton>
          <LinkButton href={previewUrl("/unternehmen", previewMode)} icon={Building2}>Unternehmen</LinkButton>
          <LinkButton href={previewUrl("/betriebe", previewMode)} icon={Users}>Betriebe</LinkButton>
          <LinkButton href={previewUrl("/faq", previewMode)} icon={FileQuestion}>FAQ</LinkButton>
          <LinkButton href={previewUrl("/handbuch", previewMode)} icon={BookOpen}>Handbuch</LinkButton>
          <LinkButton href={previewUrl("/wissen", previewMode)} icon={Brain}>Wissen</LinkButton>
        </div>
      </SectionCard>

      {/* Learner Dashboard */}
      <SectionCard
        title="Learner Dashboard"
        description="Eingeloggte Ansicht mit Kursfortschritt, Statistiken, Empfehlungen"
        icon={LayoutDashboard}
      >
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
          <LinkButton href={previewUrl("/dashboard", previewMode)} icon={LayoutDashboard}>
            Dashboard
          </LinkButton>
          <LinkButton href={previewUrl("/spaced-repetition", previewMode)} icon={Brain}>
            Spaced Repetition
          </LinkButton>
          <LinkButton href={previewUrl("/vark-test", previewMode)} icon={Sparkles}>
            VARK Lerntyp-Test
          </LinkButton>
          <LinkButton href={previewUrl("/exam-anxiety", previewMode)} icon={Shield}>
            Prüfungsangst
          </LinkButton>
        </div>
      </SectionCard>

      {/* Per-Course Testing */}
      <SectionCard
        title="Kurs-spezifisch testen"
        description="Teste Kurs, Prüfung, Tutor und Adaptive für jeden published Kurs"
        icon={GraduationCap}
      >
        {isLoading && (
          <p className="text-sm text-muted-foreground">Lade Kurse…</p>
        )}
        <div className="space-y-3 max-h-[600px] overflow-y-auto">
          {courses.map((c) => (
            <div key={c.curriculum_id} className="rounded-xl border p-4 space-y-3">
              <div className="font-medium text-sm truncate">{c.title}</div>
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                <span className="rounded-full border px-2 py-0.5">
                  {c.approved_questions} Fragen
                </span>
                <span className="rounded-full border px-2 py-0.5">
                  {c.lessons_count} Lessons
                </span>
                <span className="rounded-full border px-2 py-0.5">
                  {c.tutor_index_count} Tutor
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                <LinkButton href={previewUrl(`/dashboard?curriculum=${c.curriculum_id}`, previewMode)} icon={LayoutDashboard}>
                  Dashboard
                </LinkButton>
                <LinkButton href={previewUrl(`/courses`, previewMode)} icon={BookOpen}>
                  Kurs
                </LinkButton>
                <LinkButton href={previewUrl(`/exam-trainer?curriculum=${c.curriculum_id}`, previewMode)} icon={FileQuestion}>
                  Prüfung
                </LinkButton>
                <LinkButton href={previewUrl(`/oral-exam?curriculum=${c.curriculum_id}`, previewMode)} icon={Brain}>
                  Tutor
                </LinkButton>
                <LinkButton href={previewUrl(`/oral-exam?curriculum=${c.curriculum_id}`, previewMode)} icon={Megaphone}>
                  Oral
                </LinkButton>
                <LinkButton
                  href={previewUrl(`/exam-trainer?curriculum=${c.curriculum_id}`, "adaptive")}
                  icon={Sparkles}
                  variant="default"
                >
                  Adaptive
                </LinkButton>
              </div>
            </div>
          ))}
          {!isLoading && courses.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Keine published Kurse gefunden.
            </p>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

/* ─── Enterprise Tab ─── */
function EnterpriseTestTab({ previewMode }: { previewMode: PreviewMode }) {
  return (
    <div className="space-y-6">
      {/* Public Enterprise Pages */}
      <SectionCard
        title="Öffentliche Enterprise-Seiten"
        description="So sehen Unternehmen und Betriebe die Plattform"
        icon={Globe}
      >
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
          <LinkButton href={previewUrl("/unternehmen", previewMode)} icon={Building2}>
            Unternehmen LP
          </LinkButton>
          <LinkButton href={previewUrl("/betriebe", previewMode)} icon={Users}>
            Betriebe LP
          </LinkButton>
          <LinkButton href={previewUrl("/pruefungstraining-betriebe", previewMode)} icon={GraduationCap}>
            Training Betriebe
          </LinkButton>
          <LinkButton href={previewUrl("/pruefungstraining-institutionen", previewMode)} icon={Shield}>
            Training Institutionen
          </LinkButton>
          <LinkButton href={previewUrl("/preise", previewMode)} icon={CreditCard}>
            Preisseite
          </LinkButton>
        </div>
      </SectionCard>

      {/* Org Console */}
      <SectionCard
        title="Org Console (eingeloggt)"
        description="Dashboard für Unternehmenskunden: KPIs, Billing, Seats, Datenschutz"
        icon={Building2}
      >
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-xs text-muted-foreground">
          Die Org Console erfordert einen eingeloggten Org-Admin. Öffne sie in
          einem separaten Tab und logge dich mit einem Test-Unternehmens-Account ein.
        </div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
          <LinkButton href="/org/console" icon={BarChart3}>
            Org Console
          </LinkButton>
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Zu prüfende Bereiche:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>KPI-Dashboard: Lernfortschritt, Bestehensquote, aktive Nutzer</li>
            <li>Seat Management: Plätze zuweisen/entziehen, Einladungen</li>
            <li>Billing: Rechnungen, Zahlungsmethoden, Upgrade/Downgrade</li>
            <li>Datenschutz: DSGVO-konforme Datenlöschung, Exporte</li>
            <li>Performance: Team-Vergleich, Abteilungs-Analytics</li>
            <li>Interventionen: Automatische Warnsignale für gefährdete Lerner</li>
          </ul>
        </div>
      </SectionCard>

      {/* Enterprise Checkout Flow */}
      <SectionCard
        title="Checkout & Onboarding"
        description="Kaufprozess und Ersteinrichtung aus Unternehmenssicht"
        icon={ShoppingCart}
      >
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
          <LinkButton href={previewUrl("/shop", previewMode)} icon={ShoppingCart}>
            Shop
          </LinkButton>
          <LinkButton href={previewUrl("/courses", previewMode)} icon={BookOpen}>
            Kursübersicht
          </LinkButton>
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Checkliste:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Bundle-Kauf für mehrere Mitarbeiter</li>
            <li>Rabatt-Codes / Gutscheine</li>
            <li>Rechnungsadresse und Firmendaten</li>
            <li>Onboarding-Flow nach Kauf</li>
          </ul>
        </div>
      </SectionCard>
    </div>
  );
}

/* ─── Main Page ─── */
export default function AdminTestAreaPage() {
  const [previewMode, setPreviewMode] = useState<PreviewMode>("standard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Eye className="h-6 w-6" />
          Testbereich
        </h1>
        <p className="text-muted-foreground mt-1">
          Teste die Plattform vollständig aus Learner- und Unternehmenssicht.
        </p>
      </div>

      {/* Preview Mode Selector */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="text-xs text-muted-foreground mb-2">Vorschau-Modus</div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={previewMode === "standard" ? "default" : "outline"}
            size="sm"
            onClick={() => setPreviewMode("standard")}
          >
            Standard
          </Button>
          <Button
            variant={previewMode === "premium" ? "default" : "outline"}
            size="sm"
            onClick={() => setPreviewMode("premium")}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Premium
          </Button>
          <Button
            variant={previewMode === "adaptive" ? "default" : "outline"}
            size="sm"
            onClick={() => setPreviewMode("adaptive")}
          >
            Adaptive
          </Button>
        </div>
      </div>

      {/* Tabs: Learner vs Enterprise */}
      <Tabs defaultValue="learner" className="space-y-4">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="learner" className="gap-2">
            <GraduationCap className="h-4 w-4" />
            Learner-Sicht
          </TabsTrigger>
          <TabsTrigger value="enterprise" className="gap-2">
            <Building2 className="h-4 w-4" />
            Unternehmens-Sicht
          </TabsTrigger>
        </TabsList>
        <TabsContent value="learner">
          <LearnerTestTab previewMode={previewMode} />
        </TabsContent>
        <TabsContent value="enterprise">
          <EnterpriseTestTab previewMode={previewMode} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
