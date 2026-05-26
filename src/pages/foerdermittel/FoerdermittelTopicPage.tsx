import { Helmet } from "react-helmet-async";
import { Link, useParams, Navigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import { ProgramCard } from "@/components/foerdermittel/ProgramCard";
import { scoreMatch } from "@/lib/foerdermittel/matching";
import type { ProgramTopic } from "@/lib/foerdermittel/types";

const TOPIC_META: Record<string, { label: string; lead: string }> = {
  digitalisierung: {
    label: "Digitalisierung & KI",
    lead: "Förderungen für Software, IT-Sicherheit, Cloud, KI-Einführung und digitale Geschäftsprozesse.",
  },
  weiterbildung: {
    label: "Weiterbildung & Personal",
    lead: "Förderungen für Mitarbeiter­qualifizierung, Umschulung und Strukturwandel.",
  },
  energie: {
    label: "Energie & Nachhaltigkeit",
    lead: "Förderungen für Energieberatung, Wärmepumpen, Effizienzmaßnahmen und Erneuerbare.",
  },
  gruendung: {
    label: "Gründung & Innovation",
    lead: "Programme für Gründer, F&E-Vorhaben und Markterschließung.",
  },
};

export default function FoerdermittelTopicPage() {
  const { topic } = useParams<{ topic: string }>();
  const meta = topic ? TOPIC_META[topic] : undefined;
  if (!topic || !meta) return <Navigate to="/foerdermittel" replace />;

  const topicKey = topic as ProgramTopic;
  const programs = PROGRAMS.filter((p) => p.topics.includes(topicKey));
  const matches = programs.map((p) =>
    scoreMatch({ region: "DE", size: "small", topics: [topicKey] }, p),
  ).sort((a, b) => b.fit - a.fit);

  return (
    <main className="min-h-screen bg-background">
      <Helmet>
        <title>{meta.label} · Förderungen · FördermittelOS</title>
        <meta name="description" content={meta.lead} />
        <link rel="canonical" href={`https://berufos.com/foerdermittel/thema/${topic}`} />
      </Helmet>

      <section className="mx-auto max-w-7xl px-6 pt-8 pb-2">
        <Link to="/foerdermittel" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Alle Themen
        </Link>
      </section>

      <section className="mx-auto max-w-7xl px-6 pt-2 pb-8">
        <Badge variant="outline" className="mb-2">Themen-Cluster</Badge>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{meta.label}</h1>
        <p className="mt-3 text-lg text-muted-foreground max-w-3xl">{meta.lead}</p>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-14">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {matches.map((m) => (<ProgramCard key={m.program.id} match={m} />))}
        </div>
      </section>
    </main>
  );
}
