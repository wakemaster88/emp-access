"use client";

import { RefreshCw } from "lucide-react";

export function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white active:scale-[0.98] transition"
    >
      <RefreshCw className="h-4 w-4" />
      Erneut versuchen
    </button>
  );
}
