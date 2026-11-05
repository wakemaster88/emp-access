"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RetryButton() {
  return (
    <Button type="button" size="lg" onClick={() => window.location.reload()} className="h-11">
      <RefreshCw className="h-4 w-4" />
      Erneut versuchen
    </Button>
  );
}
