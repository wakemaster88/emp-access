"use client";

import { createElement } from "react";
import Script from "next/script";
import { ANNY_WIDGET } from "@/lib/rider-shop";

/**
 * Abo-Shop von anny.co, eingebettet über das offizielle anny-Widget
 * (`<a-organization-page>`, dasselbe wie auf tuttenbrocksee.com/shop). Das
 * Widget legt selbst ein iframe von embed.anny.co an und passt die Höhe an;
 * Buchen und Bezahlen laufen komplett bei anny.
 */
export function RiderAboShop() {
  return (
    <div className="rd-shop">
      <Script src={ANNY_WIDGET.script} strategy="afterInteractive" />
      {createElement("a-organization-page", {
        "base-url": ANNY_WIDGET.baseUrl,
        organization: ANNY_WIDGET.organization,
        locale: "de",
        "default-list": ANNY_WIDGET.list,
        "hide-organization-header": "true",
        "hide-resource-header": "false",
        "primary-color": "#1a6d73",
        "primary-color-rgb": "26, 109, 115",
        "primary-color-hover": "#155a60",
        "primary-background": "#ffffff",
        "nav-height": "0px",
      })}
      <noscript>
        <a href={`${ANNY_WIDGET.baseUrl}/b/de/${ANNY_WIDGET.organization}`}>Abos bei anny öffnen</a>
      </noscript>
    </div>
  );
}
