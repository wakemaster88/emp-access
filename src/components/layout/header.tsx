"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, Bell, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMobileMenu } from "@/components/layout/mobile-menu-context";

interface HeaderProps {
  title: string;
  accountName?: string | null;
}

export function Header({ title, accountName }: HeaderProps) {
  const { setTheme } = useTheme();
  const mobileMenu = useMobileMenu();

  return (
    <header className="sticky top-0 z-30 h-14 min-h-[3.5rem] border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm safe-area-padding pl-4 pr-4 md:pl-6 md:pr-6">
      <div className="flex items-center justify-between h-full gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {mobileMenu && (
            <Button
              variant="ghost"
              size="icon"
              onClick={mobileMenu.toggle}
              className="md:hidden h-10 w-10 shrink-0 text-slate-600 dark:text-slate-400"
              aria-label="Menü öffnen"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-lg md:text-xl font-semibold text-slate-900 dark:text-slate-100 truncate">{title}</h1>
          {accountName && (
            <span className="hidden sm:inline-flex text-sm text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-full shrink-0">
              {accountName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-10 w-10 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            <Bell className="h-5 w-5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Theme</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme("light")}>Hell</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>Dunkel</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>System</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
