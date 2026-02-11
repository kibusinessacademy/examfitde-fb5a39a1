import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Search, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Beruf = { id: string; bezeichnung_kurz: string };
type Alias = { id: string; beruf_id: string; alias: string; priority: number };

export default function AliasAdminPage() {
  const [berufe, setBerufe] = useState<Beruf[]>([]);
  const [selected, setSelected] = useState<Beruf | null>(null);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [newAlias, setNewAlias] = useState("");
  const [newPriority, setNewPriority] = useState(5);
  const [filter, setFilter] = useState("");
  const [conflicts, setConflicts] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from("berufe")
      .select("id, bezeichnung_kurz")
      .eq("ist_aktiv", true)
      .order("bezeichnung_kurz")
      .then(({ data }) => setBerufe(data ?? []));
  }, []);

  async function loadAliases(berufId: string) {
    const { data } = await supabase
      .from("beruf_aliases")
      .select("id, beruf_id, alias, priority")
      .eq("beruf_id", berufId)
      .order("priority");
    setAliases(data ?? []);
  }

  function selectBeruf(b: Beruf) {
    setSelected(b);
    loadAliases(b.id);
  }

  async function addAlias() {
    if (!selected || !newAlias.trim()) return;

    // Conflict check
    const { data: existing } = await supabase
      .from("beruf_aliases")
      .select("beruf_id, alias")
      .ilike("alias", newAlias.trim());

    const conflicting = (existing ?? []).filter((e) => e.beruf_id !== selected.id);
    if (conflicting.length > 0) {
      setConflicts(conflicting.map((c) => c.alias));
      toast.warning(`Alias „${newAlias}" existiert bereits bei einem anderen Beruf!`);
      return;
    }

    const { error } = await supabase.from("beruf_aliases").insert({
      beruf_id: selected.id,
      alias: newAlias.trim(),
      alias_norm: newAlias.trim().toLowerCase(),
      priority: newPriority,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Alias „${newAlias}" hinzugefügt`);
      setNewAlias("");
      setConflicts([]);
      loadAliases(selected.id);
    }
  }

  async function removeAlias(aliasId: string) {
    await supabase.from("beruf_aliases").delete().eq("id", aliasId);
    if (selected) loadAliases(selected.id);
    toast.success("Alias entfernt");
  }

  const filtered = berufe.filter((b) =>
    b.bezeichnung_kurz.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Beruf-Aliases / Synonyme</h1>
        <p className="text-sm text-muted-foreground">
          Verwalte Synonyme für die Berufssuche (z. B. Elektriker → Elektroniker)
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Berufsliste */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Berufe ({berufe.length})</CardTitle>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filtern…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </CardHeader>
          <CardContent className="max-h-[60vh] overflow-y-auto space-y-1 p-3 pt-0">
            {filtered.map((b) => (
              <button
                key={b.id}
                onClick={() => selectBeruf(b)}
                className={`w-full text-left text-sm px-3 py-2 rounded-md transition-colors ${
                  selected?.id === b.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                {b.bezeichnung_kurz}
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Alias Editor */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              {selected ? `Aliases: ${selected.bezeichnung_kurz}` : "Beruf auswählen"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <p className="text-sm text-muted-foreground">
                Wähle links einen Beruf aus, um seine Synonyme zu bearbeiten.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Add new */}
                <div className="flex gap-2">
                  <Input
                    placeholder="Neues Synonym…"
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addAlias()}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={newPriority}
                    onChange={(e) => setNewPriority(Number(e.target.value))}
                    className="w-20"
                    title="Priorität (1=hoch)"
                  />
                  <Button size="sm" onClick={addAlias} disabled={!newAlias.trim()}>
                    <Plus className="h-4 w-4 mr-1" /> Hinzufügen
                  </Button>
                </div>

                {conflicts.length > 0 && (
                  <div className="flex items-center gap-2 text-sm text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 rounded-md p-2">
                    <AlertTriangle className="h-4 w-4" />
                    Konflikt: Alias existiert bereits bei anderem Beruf
                  </div>
                )}

                {/* Existing aliases */}
                <div className="space-y-2">
                  {aliases.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Keine Aliases vorhanden.</p>
                  ) : (
                    aliases.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{a.alias}</span>
                          <Badge variant="outline" className="text-xs">
                            P{a.priority}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => removeAlias(a.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
