"use client";

import { useEffect, useState } from "react";
import { TileFrame } from "./tile-frame";
import type { IframeWidget } from "@/lib/types";

interface IframeTileProps {
  widget: IframeWidget;
}

export function IframeTile({ widget }: IframeTileProps) {
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!widget.reloadMin || widget.reloadMin <= 0) return;
    const id = setInterval(() => {
      setReloadKey((k) => k + 1);
    }, widget.reloadMin * 60 * 1000);
    return () => clearInterval(id);
  }, [widget.reloadMin]);

  const zoom = widget.zoom ?? 1;
  const scale = zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: "top left", width: `${100 / zoom}%`, height: `${100 / zoom}%` } : undefined;

  // Bei aktivem Proxy: Embed-URL über die App, damit X-Frame/CSP gestrippt werden.
  const src = widget.proxy ? `/api/embed/${encodeURIComponent(widget.id)}` : widget.url;

  return (
    <TileFrame title={widget.title} showTitleBar={widget.showTitleBar}>
      <iframe
        key={reloadKey}
        src={src}
        sandbox={widget.sandbox}
        referrerPolicy="no-referrer"
        allow="fullscreen; autoplay; clipboard-read; clipboard-write"
        className="absolute inset-0 h-full w-full border-0 bg-black"
        style={scale}
      />
    </TileFrame>
  );
}
