"use client";

import { TileFrame } from "./tile-frame";
import { SnapshotImage } from "./snapshot-image";
import type { ImageRefreshWidget } from "@/lib/types";

interface ImageRefreshTileProps {
  widget: ImageRefreshWidget;
}

export function ImageRefreshTile({ widget }: ImageRefreshTileProps) {
  return (
    <TileFrame title={widget.title} showTitleBar={widget.showTitleBar}>
      <SnapshotImage url={widget.url} intervalMs={widget.intervalMs} />
    </TileFrame>
  );
}
