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
    accent === "success" ? "bg-success/15 text-success"
    : accent === "destructive" ? "bg-destructive/15 text-destructive"
    : accent === "warning" ? "bg-warning/15 text-warning"
    : "bg-primary/15 text-primary";

  return (
    <Card className={`relative overflow-hidden border-border/50 shadow-card ${gradient ? "bg-gradient-primary text-primary-foreground" : "bg-gradient-card"}`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className={`text-xs uppercase tracking-wider ${gradient ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{label}</p>
          <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${gradient ? "bg-white/15" : accentClass}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-3 font-display text-2xl lg:text-3xl font-bold tracking-tight">{value}</p>
        {hint && <p className={`text-xs mt-1 ${gradient ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{hint}</p>}
      </CardContent>
    </Card>
  );
}
