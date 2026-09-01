import { describe, expect, it } from "vitest";
import { WidgetSchema } from "@/lib/types";

describe("ServicesWidgetSchema", () => {
  it("parst die Dienste-Kachel mit Defaults", () => {
    const widget = WidgetSchema.parse({
      id: "w-dienste",
      title: "Dienste",
      type: "services",
    });
    expect(widget.type).toBe("services");
    if (widget.type !== "services") return;
    expect(widget.intervalMs).toBe(5000);
    expect(widget.enabled).toBe(true);
    expect(widget.showTitleBar).toBe(true);
  });

  it("lehnt zu schnelles Polling ab", () => {
    const parsed = WidgetSchema.safeParse({
      id: "w-dienste",
      title: "Dienste",
      type: "services",
      intervalMs: 500,
    });
    expect(parsed.success).toBe(false);
  });
});
