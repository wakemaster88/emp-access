"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { keepInitialFocusOffClose } from "@/components/ui/initial-focus"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/45 backdrop-blur-[3px]",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-popover text-popover-foreground fixed z-50 grid w-full grid-cols-[minmax(0,1fr)] gap-4 border border-glass-border shadow-[inset_0_1px_0_var(--glass-highlight),0_30px_80px_-24px_oklch(0_0_0/55%)] outline-none duration-300",
          "bottom-0 left-0 max-h-[92dvh] overflow-y-auto overscroll-contain scrollbar-thin rounded-t-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          "sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:max-w-lg sm:max-h-[85vh] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-card sm:p-6",
          "sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
          className
        )}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event)
          // Erster Fokus nie auf dem X (kein Fokusring beim Öffnen).
          if (!event.defaultPrevented) keepInitialFocusOffClose(event, closeRef.current)
        }}
        {...props}
      >
        <div aria-hidden className="mx-auto -mt-1 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-foreground/15 sm:hidden" />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            ref={closeRef}
            data-slot="dialog-close"
            className="press absolute top-3.5 right-3.5 inline-flex size-8 items-center justify-center rounded-full after:absolute after:-inset-1.5 after:content-[''] bg-glass-tile text-muted-foreground ring-1 ring-inset ring-glass-border hover:text-foreground hover:bg-glass-strong focus-visible:ring-[3px] focus-visible:ring-ring/50 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Schließen</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

/**
 * Tastenzeile eines Dialogs: auf dem Handy untereinander (Primärtaste oben),
 * ab sm rechtsbündig nebeneinander. `start` steht ab sm links (z. B. ein
 * destruktives „Löschen“), auf dem Handy ganz unten.
 */
function DialogFooter({
  className,
  showCloseButton = false,
  start,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
  start?: React.ReactNode
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {start != null && start !== false && (
        <div data-slot="dialog-footer-start" className="flex flex-col-reverse gap-2 sm:mr-auto sm:flex-row">
          {start}
        </div>
      )}
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Schließen</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-tight font-semibold tracking-tight pr-8", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
