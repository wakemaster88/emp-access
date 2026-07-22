import Link from "next/link";
import { ToastProvider } from "@/components/ui/toast";
import { AdminNav } from "@/components/admin/admin-nav";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Admin – Webcams Dashboard",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Zurück zum Dashboard
            </Link>
            <div className="h-5 w-px bg-border" />
            <h1 className="text-base font-medium tracking-tight">Admin</h1>
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-56 shrink-0 border-r border-border bg-tile/30">
            <AdminNav />
          </aside>
          <main className="flex-1 overflow-y-auto p-8">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
