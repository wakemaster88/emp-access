import * as React from "react"
import { SearchIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * Suchfeld (docs/design-regeln.md, Abschnitt 16): `Input` mit Lupe vorn,
 * standardmäßig `type="search"`. Mit `onClear` erscheint rechts eine kleine
 * Taste „Suche leeren“, sobald das (gesteuerte) Feld einen Wert hat; danach
 * steht der Fokus wieder im Feld.
 *
 * Alle Input-Eigenschaften gehen an das Feld (`className` auch);
 * `containerClassName` setzt Breite oder Rasterspalte des Rahmens. Das Feld
 * braucht einen Namen: sichtbares Label, `aria-label` oder `placeholder`
 * plus `aria-label`.
 */
function SearchInput({
  className,
  containerClassName,
  type = "search",
  onClear,
  ...props
}: React.ComponentProps<"input"> & {
  containerClassName?: string
  /** Leert die Suche; die Taste erscheint nur bei nicht leerem `value`. */
  onClear?: () => void
}) {
  const hasValue = props.value !== undefined && props.value !== null && String(props.value) !== ""
  const showClear = !!onClear && hasValue
  return (
    <div data-slot="search-input" className={cn("relative w-full min-w-0", containerClassName)}>
      {/* z-10: sonst malt die Glasfläche des Feldes über das Symbol. */}
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type={type}
        className={cn(
          // Kein natives Suchfeld-Aussehen und kein natives Löschen-X (eigene Taste).
          "appearance-none pl-8 [&::-webkit-search-cancel-button]:appearance-none",
          showClear && "pr-9",
          className
        )}
        {...props}
      />
      {showClear && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Suche leeren"
          onClick={(event) => {
            // Mit dem leeren Wert verschwindet die Taste: Fokus zurück ins Feld,
            // sonst fiele er auf die Seite (bzw. den Dialog) zurück.
            const input = event.currentTarget.parentElement?.querySelector("input")
            onClear()
            input?.focus()
          }}
          className="absolute top-1/2 right-1.5 z-10 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}

export { SearchInput }
