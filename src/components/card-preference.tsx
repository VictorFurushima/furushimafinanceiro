import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCardPreference } from "@/hooks/use-card-preference";
import type { CreditCard } from "@/hooks/use-finance-data";
export function CardPreference({
  cards,
  prompt = false,
}: {
  cards: CreditCard[];
  prompt?: boolean;
}) {
  const preference = useCardPreference();
  const [chosen, setChosen] = useState("");
  const [configuring, setConfiguring] = useState(false);
  const active = cards.filter((c) => c.status === "active");
  const primary = active.find((c) => c.id === preference.data?.primary_card_id);
  if (
    !preference.isSuccess ||
    !active.length ||
    (prompt && (active.length < 2 || primary || preference.data?.primary_card_prompt_dismissed))
  )
    return null;
  return (
    <div className="rounded-lg border border-border/50 p-3 space-y-3">
      <p className="text-sm">
        {prompt
          ? "Você possui mais de um cartão. Deseja definir um cartão principal para agilizar os próximos lançamentos?"
          : `Cartão principal: ${primary?.name ?? "Nenhum definido"}`}
      </p>
      {!prompt || configuring ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={chosen || primary?.id || "none"}
            disabled={preference.saving}
            onValueChange={setChosen}
          >
            <SelectTrigger className="w-full sm:w-64" aria-label="Cartão principal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum principal</SelectItem>
              {active.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.last_four ? ` •••• ${c.last_four}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={preference.saving || !chosen}
            onClick={async () => {
              try {
                await preference.savePreference({
                  primary_card_id: chosen === "none" ? null : chosen,
                  primary_card_prompt_dismissed: chosen === "none",
                });
                toast.success("Preferência de cartão salva");
                setChosen("");
              } catch {
                /* hook reports error */
              }
            }}
          >
            Salvar preferência
          </Button>
        </div>
      ) : (
        <Button size="sm" disabled={preference.saving} onClick={() => setConfiguring(true)}>
          Definir cartão principal
        </Button>
      )}
      {prompt && (
        <Button
          variant="ghost"
          size="sm"
          disabled={preference.saving}
          onClick={() => {
            void preference.savePreference({ primary_card_prompt_dismissed: true }).catch(() => {});
          }}
        >
          Agora não
        </Button>
      )}
    </div>
  );
}
