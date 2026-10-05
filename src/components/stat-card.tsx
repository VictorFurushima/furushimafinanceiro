import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  gradient?: boolean;
  accent?: "success" | "destructive" | "warning" | "primary";
}

export function StatCard({ label, value, hint, icon: Icon, gradient, accent = "primary" }: Props) {
  const accentClass =
    accent === "success"
      ? "bg-success/15 text-success"
      : accent === "destructive"
        ? "bg-destructive/15 text-destructive"
        : accent === "warning"
          ? "bg-warning/15 text-warning"
          : "bg-primary/15 text-primary";

  return (
    <Card
      className={`relative overflow-hidden ${gradient ? "border-primary/35 bg-primary/8" : "bg-card"}`}
    >
      <CardContent className="p-3 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <p
            className={`text-[10px] sm:text-xs uppercase tracking-[0.08em] leading-tight ${gradient ? "text-primary" : "text-muted-foreground"}`}
          >
            {label}
          </p>
          <div
            className={`h-7 w-7 sm:h-8 sm:w-8 rounded-md flex items-center justify-center shrink-0 ${gradient ? "bg-primary/12 text-primary" : accentClass}`}
          >
            <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </div>
        </div>
        <p className={`mt-2 sm:mt-3 font-display text-lg sm:text-2xl lg:text-3xl font-semibold tabular-nums break-words leading-tight ${gradient ? "text-foreground" : ""}`}>
          {value}
        </p>
        {hint && (
          <p
            className="text-[10px] sm:text-xs mt-1 text-muted-foreground"
          >
            {hint}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
