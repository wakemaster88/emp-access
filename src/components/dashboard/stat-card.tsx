import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  color?: "indigo" | "emerald" | "rose" | "amber";
}

const colorMap = {
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

export function StatCard({ title, value, icon: Icon, trend, color = "indigo" }: StatCardProps) {
  return (
    <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
            <p className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mt-1">{value}</p>
            {trend && (
              <p className={cn("text-xs mt-1", trend.value >= 0 ? "text-emerald-600" : "text-rose-600")}>
                {trend.value >= 0 ? "+" : ""}{trend.value}% {trend.label}
              </p>
            )}
          </div>
          <div className={cn("h-10 w-10 sm:h-12 sm:w-12 rounded-xl flex items-center justify-center shrink-0", colorMap[color])}>
            <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
