"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useCallback, useEffect } from "react";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";

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
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        ref={inputRef}
        placeholder="Code scannen oder eingeben …"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        // text-ellipsis: auf dem Handy (16 px) passt der Platzhalter nicht ganz; Auslassung statt Abriss.
        className="font-mono text-ellipsis"
        containerClassName="flex-1 basis-56 max-w-md"
        autoComplete="off"
        autoFocus
      />
      <Button type="button" variant="outline" onClick={handleSearch} className="shrink-0">
        Suchen
      </Button>
      {currentCode && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setValue("");
            const params = new URLSearchParams(searchParams.toString());
            params.delete("code");
            const q = params.toString();
            router.push(`/tickets${q ? `?${q}` : ""}`);
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          Filter zurücksetzen
        </Button>
      )}
    </div>
  );
}
