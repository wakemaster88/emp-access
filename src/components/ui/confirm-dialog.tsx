"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Notice } from "@/components/ui/notice"

/** Fehlertext aus einer geworfenen Ausnahme. */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return "Das hat nicht geklappt. Bitte erneut versuchen."
}

/*
 * Während die Handlung läuft, ist die Bestätigen-Taste nur `aria-disabled`,
 * nicht `disabled`: eine gesperrte Taste verliert den Fokus (er fiele aus der
 * Ebene heraus). Ein unsichtbarer Status sagt „Löschen …“ an.
 */
const busyClass = "aria-disabled:pointer-events-none aria-disabled:opacity-50"

/**
 * Bestätigung als eigene Ebene (docs/design-regeln.md, Abschnitt 18): für
 * Löschen, Sperren und andere Handlungen, die sich nicht zurücknehmen
 * lassen – von einer Seite oder Liste aus. Gesteuert über `open` und
 * `onOpenChange`.
 *
 * `onConfirm` darf ein Promise liefern: solange es läuft, zeigt die Taste
 * einen Spinner und „…“, beide Tasten und Escape sind gesperrt (die
 * Bestätigen-Taste behält den Fokus). Wirft es, bleibt die Ebene offen und
 * zeigt die Meldung als Hinweis; sonst schließt sie. Aus einem Dialog heraus
 * `ConfirmStep` nehmen – ein Dialog öffnet nie einen zweiten.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Löschen",
  cancelLabel = "Abbrechen",
  destructive = true,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Die Frage: „Regel „Sommer“ löschen?“ */
  title: React.ReactNode
  /** Was passiert, was bleibt: „Der Verlauf bleibt erhalten.“ */
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** `true` (Standard): Bestätigen ist eine destruktive Taste. */
  destructive?: boolean
  onConfirm: () => void | Promise<void>
  /** Zusätzlicher Inhalt zwischen Text und Tasten (z. B. betroffene Einträge). */
  children?: React.ReactNode
}) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    // Während die Handlung läuft, bleibt die Ebene offen (auch bei Escape).
    if (pending) return
    if (!next) setError(null)
    onOpenChange(next)
  }

  const confirm = async () => {
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      setPending(false)
      onOpenChange(false)
    } catch (e) {
      setPending(false)
      setError(errorMessage(e))
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent {...(description ? {} : { "aria-describedby": undefined })}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        {error && <Notice tone="danger" compact title={error} />}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            aria-disabled={pending || undefined}
            className={busyClass}
            onClick={(event) => {
              // Radix würde sonst sofort schließen – geschlossen wird erst nach Erfolg.
              event.preventDefault()
              if (pending) return
              void confirm()
            }}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {pending ? `${confirmLabel} …` : confirmLabel}
          </AlertDialogAction>
          <span role="status" className="sr-only">
            {pending ? `${confirmLabel} …` : ""}
          </span>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Rückfrage innerhalb eines Dialogs (Abschnitt 18: ein Dialog öffnet nie
 * einen zweiten): ersetzt die Fußzeile durch einen roten Hinweis mit der
 * Frage und eine Tastenzeile. Handy: Tasten volle Breite, Bestätigen oben;
 * ab sm rechtsbündig. Abbrechen bekommt beim Erscheinen den Fokus.
 *
 * `onConfirm` darf ein Promise liefern (Spinner, Tasten gesperrt); wirft es,
 * steht die Meldung im Hinweis. `pending` zeigt einen Ladezustand, den der
 * Dialog selbst verwaltet (z. B. `deleting`).
 */
function ConfirmStep({
  title,
  description,
  confirmLabel = "Löschen",
  cancelLabel = "Abbrechen",
  destructive = true,
  icon: Icon,
  pending = false,
  onConfirm,
  onCancel,
  className,
}: {
  /** Die Frage: „Verein „TSV“ wirklich löschen?“ */
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /** Symbol vor der Bestätigen-Beschriftung, z. B. `Trash2`. */
  icon?: LucideIcon
  pending?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  className?: string
}) {
  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const busy = pending || running

  const confirm = async () => {
    setRunning(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  const hasBody = (description != null && description !== false) || !!error

  return (
    <div data-slot="confirm-step" className={cn("space-y-3", className)}>
      <Notice tone="danger" compact title={title}>
        {hasBody ? (
          <>
            {description}
            {error && <p className="mt-1 font-medium text-destructive">{error}</p>}
          </>
        ) : null}
      </Notice>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy} autoFocus>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={destructive ? "destructive" : "default"}
          onClick={() => {
            if (!busy) void confirm()
          }}
          aria-disabled={busy || undefined}
          className={busyClass}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : Icon ? <Icon aria-hidden /> : null}
          {busy ? `${confirmLabel} …` : confirmLabel}
        </Button>
        <span role="status" className="sr-only">
          {busy ? `${confirmLabel} …` : ""}
        </span>
      </div>
    </div>
  )
}

export { ConfirmDialog, ConfirmStep }
