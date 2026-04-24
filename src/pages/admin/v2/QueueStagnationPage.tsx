import { Helmet } from "react-helmet-async";
import { QueueStagnationCard } from "@/components/admin/queue/QueueStagnationCard";

export default function QueueStagnationPage() {
  return (
    <div className="container mx-auto max-w-5xl space-y-4 p-4">
      <Helmet>
        <title>Queue-Stagnation · Admin</title>
        <meta
          name="description"
          content="Priorisiert stagnierende Failed-Queue-Jobs (≥30 Min identische job_ids) und REQUEUE_LOOP_KILLED-Cluster. Direkter Deep-Link zu betroffenen Jobs."
        />
      </Helmet>
      <header>
        <h1 className="text-xl font-semibold">Queue-Stagnation & REQUEUE-Loops</h1>
        <p className="text-xs text-muted-foreground">
          Identische Failed-Jobs ≥30 Min und terminal markierte Loop-Jobs in einer Ansicht.
        </p>
      </header>
      <QueueStagnationCard />
    </div>
  );
}
