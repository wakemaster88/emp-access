/**
 * Erster Fokus beim Öffnen von Dialog und Sheet (`onOpenAutoFocus`).
 *
 * Radix fokussiert das erste fokussierbare Element ohne Links. Steht davor
 * kein Bedienelement, wäre das das Schließen-X oben rechts – mit Fokusring
 * gleich beim Öffnen. Dann bekommt stattdessen die Ebene selbst den Fokus
 * (ohne Ring); Tab führt danach zum X. In allen anderen Fällen bleibt es beim
 * Verhalten von Radix. Escape und Klick auf das X ändern sich nicht.
 *
 * `event.currentTarget` ist der Inhalt der Ebene (FocusScope von Radix).
 */
export function keepInitialFocusOffClose(event: Event, closeButton: HTMLElement | null) {
  const container = event.currentTarget;
  if (!closeButton || !(container instanceof HTMLElement)) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const el = node as HTMLElement & { disabled?: boolean };
      const hiddenInput = el instanceof HTMLInputElement && el.type === "hidden";
      if (el.disabled || el.hidden || hiddenInput) return NodeFilter.FILTER_SKIP;
      return el.tabIndex >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  while (walker.nextNode()) {
    const el = walker.currentNode as HTMLElement;
    // Wie Radix: Links auslassen; unsichtbare Elemente können keinen Fokus nehmen.
    if (el.tagName === "A") continue;
    if (el.getClientRects().length === 0 || getComputedStyle(el).visibility === "hidden") continue;
    // Ein anderes Bedienelement kommt zuerst: Radix fokussiert es wie gewohnt.
    if (el !== closeButton) return;
    break;
  }

  // Sonst wäre das X das erste Ziel: Fokus auf die Ebene selbst.
  event.preventDefault();
  container.focus({ preventScroll: true });
}
