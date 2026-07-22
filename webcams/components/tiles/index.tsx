"use client";

import { ReolinkTile } from "./reolink-tile";
import { IframeTile } from "./iframe-tile";
import { ImageRefreshTile } from "./image-refresh-tile";
import { ClockTile } from "./clock-tile";
import { DoorbirdTile } from "./doorbird-tile";
import type { Cam, DoorbirdConfig, Widget } from "@/lib/types";

interface TileProps {
  widget: Widget;
  cams: Cam[];
  go2rtcUrl: string;
  doorbird?: DoorbirdConfig;
  focused?: boolean;
  onFocus?: () => void;
  reloadKey?: number;
}

export function Tile({
  widget,
  cams,
  go2rtcUrl,
  doorbird,
  focused = false,
  onFocus,
  reloadKey,
}: TileProps) {
  switch (widget.type) {
    case "reolink": {
      const cam = cams.find((c) => c.id === widget.camId);
      return (
        <ReolinkTile
          widget={widget}
          cam={cam}
          go2rtcUrl={go2rtcUrl}
          focused={focused}
          onFocus={onFocus}
          reloadKey={reloadKey}
        />
      );
    }
    case "iframe":
      return <IframeTile widget={widget} />;
    case "image-refresh":
      return <ImageRefreshTile widget={widget} />;
    case "clock":
      return <ClockTile widget={widget} />;
    case "doorbird":
      if (!doorbird) return null;
      return (
        <DoorbirdTile
          widget={widget}
          doorbird={doorbird}
          go2rtcUrl={go2rtcUrl}
          focused={focused}
          onFocus={onFocus}
        />
      );
    default:
      return null;
  }
}
