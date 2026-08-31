import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NoteDialog, NOTE_LINK_TYPES, noteLinkLabel } from "@/components/note-dialog";
import { supabase } from "@/integrations/supabase/client";
import { invalidateFinance } from "@/lib/query-keys";
import { useNotes, type Note } from "@/hooks/use-app-data";
import { useRole, VIEWER_MESSAGE } from "@/hooks/use-role";
import { formatDateOnlyPtBR, toLocalDateString, todayISO, parseDateOnly } from "@/lib/date-only";

export const Route = createFileRoute("/_app/notes")({
  component: NotesPage,
  head: () => ({
    meta: [
      { title: "Anotações — Furushima Financeiro" },
      {
        name: "description",
        content: "Organize observações, planos e lembretes ligados às suas finanças.",
      },
    ],
  }),
});

function NotesPage() {
  const { data: notes = [], isLoading } = useNotes();
  const { isAdmin } = useRole();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [search, setSearch] = useState("");
  const [linkFilter, setLinkFilter] = useState("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (linkFilter !== "all" && n.link_type !== linkFilter) return false;
      if (!q) return true;
      return n.title.toLowerCase().includes(q) || (n.content ?? "").toLowerCase().includes(q);
    });
  }, [notes, search, linkFilter]);

  const remove = async (n: Note) => {
    if (!isAdmin) return toast.error(VIEWER_MESSAGE);
    if (!confirm(`Excluir a nota "${n.title}"?`)) return;
    const { error } = await supabase.from("notes").delete().eq("id", n.id);
    if (error) return toast.error(error.message);
    toast.success("Nota excluída");
    invalidateFinance(qc, "notes");
  };

  return (
    <div className="p-3 sm:p-4 sm:p-6 lg:p-10 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs sm:text-sm text-muted-foreground">Seu caderno financeiro</p>
          <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold mt-1">
            Anotações
          </h1>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
            className="bg-gradient-primary text-primary-foreground shadow-glow w-full sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" /> Nova anotação
          </Button>
        )}
      </header>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por título ou conteúdo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar anotações"
          />
        </div>
        <Select value={linkFilter} onValueChange={setLinkFilter}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os vínculos</SelectItem>
            {NOTE_LINK_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Carregando...</p>
      ) : filtered.length === 0 ? (
        <Card className="bg-gradient-card border-border/50 shadow-card">
          <CardContent className="py-14 text-center space-y-2">
            <StickyNote className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhuma anotação encontrada.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {filtered.map((n) => (
            <Card key={n.id} className="bg-gradient-card border-border/50 shadow-card">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="font-display text-base sm:text-lg leading-tight">
                    {n.title}
                  </CardTitle>
                  {isAdmin && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditing(n);
                          setOpen(true);
                        }}
                        aria-label="Editar anotação"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => remove(n)}
                        aria-label="Excluir anotação"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">
                    {noteLinkLabel(n.link_type)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateOnlyPtBR(n.note_date)}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
                  {n.content}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NoteDialog open={open} onOpenChange={setOpen} editing={editing} />
    </div>
  );
}
