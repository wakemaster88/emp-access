"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useCallback, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface TicketCodeSearchProps {
  currentCode?: string;
  currentArea?: string;
  currentShowAll?: boolean;
}

export function TicketCodeSearch({
  currentCode,
  currentArea,
  currentShowAll,
}: TicketCodeSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(currentCode ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(currentCode ?? "");
  }, [currentCode]);

  const buildTicketsUrl = useCallback(
    (code: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (code.trim()) params.set("code", code.trim());
      else params.delete("code");
      const q = params.toString();
      return `/tickets${q ? `?${q}` : ""}`;
    },
    [searchParams]
  );

  const handleSearch = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("code");
      const q = params.toString();
      router.push(`/tickets${q ? `?${q}` : ""}`);
      return;
    }
    router.push(buildTicketsUrl(trimmed));
  }, [value, router, buildTicketsUrl, searchParams]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSearch();
      }
    },
    [handleSearch]
  );

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Code scannen oder eingeben …"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="pl-9 font-mono text-sm"
          autoComplete="off"
          autoFocus
        />
      </div>
      <button
        type="button"
        onClick={handleSearch}
        className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap"
      >
        Suchen
      </button>
      {currentCode && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            const params = new URLSearchParams(searchParams.toString());
            params.delete("code");
            const q = params.toString();
            router.push(`/tickets${q ? `?${q}` : ""}`);
          }}
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          Filter zurücksetzen
        </button>
      )}
    </div>
  );
}
