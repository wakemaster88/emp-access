"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Merge, Pencil, Trash2, UserPen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { CustomerAccountRow, CustomerAccountsData, CustomerPersonRow } from "@/lib/customer-accounts";
import { ageFrom, fmtDay, RiderForm, type RiderChoice } from "./rider-form";

/** So viele Konten zeigt die Tabelle ohne Suche. */
const PAGE = 100;

function personName(p: Pick<CustomerPersonRow, "firstName" | "lastName">): string {
  return [p.firstName, p.lastName].filter((v) => v?.trim()).join(" ").trim() || "Ohne Namen";
}

/** Wie das Konto heißt: Inhaber, sonst erste Person, sonst die Adresse. */
function holderOf(c: CustomerAccountRow): string {
  return c.name?.trim() || (c.persons[0] ? personName(c.persons[0]) : c.email);
}

function runningAbos(c: CustomerAccountRow) {
  return c.abos.filter((a) => a.running);
}

function ridersOpen(c: CustomerAccountRow): number {
  return c.abos.filter((a) => a.running && a.riderId == null).length;
}

function matches(c: CustomerAccountRow, q: string): boolean {
  return holderOf(c).toLowerCase().includes(q)
    || c.email.includes(q)
    || c.aliasEmails.some((e) => e.includes(q))
    || c.persons.some((p) => personName(p).toLowerCase().includes(q));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

type Step =
  | { kind: "overview" }
  | { kind: "person"; personId: number }
  | { kind: "rider"; aboId: number }
  | { kind: "merge"; fromId: number | null };

/**
 * Kundenkonten (Abos › Kundenkonten): ein Konto je E-Mail-Adresse mit den
 * Personen, die mit seinen Abos fahren. Hier pflegt man Name und
 * Geburtsdatum der Personen, sagt, wer mit einem Abo fährt, und legt zwei
 * Konten derselben Familie zusammen.
 */
export function CustomerAccountsCard({ data, canMerge }: { data: CustomerAccountsData; canMerge: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [step, setStep] = useState<Step>({ kind: "overview" });
  const [flash, setFlash] = useState<string | null>(null);

  const byId = useMemo(() => new Map(data.rows.map((c) => [c.id, c])), [data.rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? data.rows.filter((c) => matches(c, q)) : data.rows;
  }, [data.rows, query]);
  // Vorschläge, deren Konten es (nach dem Zusammenlegen) noch gibt.
  const duplicates = useMemo(
    () => data.duplicates
      .map((g) => ({ ...g, rows: g.ids.map((id) => byId.get(id)).filter((c): c is CustomerAccountRow => c != null) }))
      .filter((g) => g.rows.length > 1),
    [data.duplicates, byId],
  );

  const open = openId != null ? byId.get(openId) ?? null : null;

  function openAccount(id: number, next: Step = { kind: "overview" }) {
    setFlash(null);
    setStep(next);
    setOpenId(id);
  }

  function done(message: string | null = null) {
    setFlash(message);
    setStep({ kind: "overview" });
    router.refresh();
  }

  return (
    <>
      {canMerge && duplicates.length > 0 && (
        <Notice tone="info" title={`Vielleicht doppelt (${duplicates.length})`}>
          <p>Diese Konten tragen denselben Namen oder dieselbe anny-Kundennummer. Gehören sie zu einer Familie, leg sie zusammen.</p>
          <ul className="mt-2 space-y-1.5">
            {duplicates.map((g) => (
              <li key={g.ids.join(",")} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-foreground">{g.label || holderOf(g.rows[0])}</span>
                <span className="break-all">{g.rows.map((c) => c.email).join(", ")}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="max-sm:h-11"
                  onClick={() => openAccount(g.rows[0].id, { kind: "merge", fromId: g.rows[1].id })}
                >
                  Prüfen
                </Button>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <Card flush>
        <CardHeader>
          <CardTitle>Kundenkonten ({data.rows.length})</CardTitle>
          <CardDescription>
            Ein Konto je E-Mail-Adresse, darin die Personen, die mit den Abos fahren, etwa Eltern und Kinder.
          </CardDescription>
        </CardHeader>
        <div className="px-4 pb-3 sm:px-5">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            placeholder="Name oder E-Mail suchen"
            aria-label="Name oder E-Mail suchen"
            containerClassName="sm:max-w-sm"
          />
        </div>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Konto</TableHead>
              <TableHead className="max-sm:hidden">Personen</TableHead>
              <TableHead className="text-right max-sm:hidden">Laufende Abos</TableHead>
              <TableHead className="text-right">Öffnen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && <TableEmpty colSpan={4} title="Kein Konto gefunden." />}
            {shown.slice(0, PAGE).map((c) => {
              const openRiders = ridersOpen(c);
              const running = runningAbos(c).length;
              return (
                <TableRow key={c.id}>
                  <TableCell className="max-sm:whitespace-normal">
                    <div className="flex flex-wrap items-center gap-1.5 font-medium">
                      {holderOf(c)}
                      {openRiders > 0 && <Badge variant="warning">Fahrer offen</Badge>}
                    </div>
                    <div className="pt-0.5 text-xs text-muted-foreground">
                      <span className="break-all">{c.email}</span>
                      {c.aliasEmails.length > 0 && <span> · {plural(c.aliasEmails.length, "weitere Adresse", "weitere Adressen")}</span>}
                      <span className="sm:hidden"> · {plural(c.persons.length, "Person", "Personen")} · {plural(running, "Abo", "Abos")}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal max-sm:hidden">
                    {c.persons.length > 0 ? c.persons.map(personName).join(", ") : <span className="text-muted-foreground">–</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums max-sm:hidden">{running}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Konto ${holderOf(c)} öffnen`}
                      className="max-sm:size-11"
                      onClick={() => openAccount(c.id)}
                    >
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {shown.length > PAGE && (
          <p className="px-4 py-3 text-xs text-muted-foreground sm:px-5">
            Zeigt {PAGE} von {shown.length} Konten. Die Suche grenzt ein.
          </p>
        )}
      </Card>

      <Dialog open={open != null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="sm:max-w-lg">
          {open && (
            <AccountDialogBody
              key={open.id}
              account={open}
              rows={data.rows}
              suggestions={duplicates.filter((g) => g.ids.includes(open.id)).flatMap((g) => g.ids).filter((id) => id !== open.id)}
              canMerge={canMerge}
              step={step}
              setStep={setStep}
              flash={flash}
              onDone={done}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AccountDialogBody({
  account: c,
  rows,
  suggestions,
  canMerge,
  step,
  setStep,
  flash,
  onDone,
}: {
  account: CustomerAccountRow;
  rows: CustomerAccountRow[];
  suggestions: number[];
  canMerge: boolean;
  step: Step;
  setStep: (s: Step) => void;
  flash: string | null;
  onDone: (message?: string | null) => void;
}) {
  const back = () => setStep({ kind: "overview" });
  const riderChoices: RiderChoice[] = c.persons.map((p) => ({
    id: p.id,
    name: personName(p),
    birthDate: p.birthDate,
    abos: [...new Set(c.abos.filter((a) => a.running && a.riderId === p.id).map((a) => a.aboName))],
  }));

  const header = (title: string, description: string) => (
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription className="break-all">{description}</DialogDescription>
    </DialogHeader>
  );

  if (step.kind === "person") {
    const p = c.persons.find((x) => x.id === step.personId);
    if (!p) return null;
    return (
      <>
        {header("Person bearbeiten", `${holderOf(c)} · ${c.email}`)}
        <PersonForm
          person={p}
          canDelete={canMerge}
          onCancel={back}
          onDone={() => onDone("Person gespeichert.")}
          onDeleted={() => onDone(`${personName(p)} gelöscht.`)}
        />
      </>
    );
  }

  if (step.kind === "rider") {
    const a = c.abos.find((x) => x.id === step.aboId);
    if (!a) return null;
    return (
      <>
        {header(
          "Fahrer ändern",
          `${a.aboName} · bis ${fmtDay(a.endDate)}. Am Abo steht ${a.ticketName}`
            + (a.ticketBirthDate ? `, geboren ${fmtDay(a.ticketBirthDate, "")}.` : "."),
        )}
        <RiderForm
          ticketId={a.id}
          persons={riderChoices}
          current={a.riderId}
          initialLastName={a.lastName}
          cancelLabel="Zurück"
          onCancel={back}
          onDone={() => onDone("Fahrer gespeichert.")}
        />
      </>
    );
  }

  if (step.kind === "merge") {
    return (
      <>
        {header("Konten zusammenlegen", `Ein anderes Konto kommt in das Konto ${holderOf(c)} (${c.email}).`)}
        <MergeStep
          into={c}
          rows={rows}
          suggestions={suggestions}
          fromId={step.fromId}
          onPick={(fromId) => setStep({ kind: "merge", fromId })}
          onCancel={back}
          onDone={onDone}
        />
      </>
    );
  }

  const aliases = c.aliasEmails.length > 0 ? ` · weitere: ${c.aliasEmails.join(", ")}` : "";
  return (
    <>
      {header(holderOf(c), `${c.email}${aliases}`)}
      {flash && <Notice tone="success" compact title={flash} />}

      <div className="space-y-2">
        <SectionHeading title={`Personen (${c.persons.length})`} />
        {c.persons.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Person. Sie entsteht, sobald jemand mit einem Abo fährt.</p>
        ) : (
          <div className="glass-tile divide-y divide-border overflow-hidden">
            {c.persons.map((p) => {
              const age = ageFrom(p.birthDate);
              return (
                <div key={p.id} className="flex min-h-11 items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {personName(p)}
                      {age != null && <span className="text-xs font-normal text-muted-foreground tabular-nums">({age})</span>}
                      {p.app && <Badge variant="neutral">App</Badge>}
                      {p.tickets === 0 && <Badge variant="neutral">ohne Abo</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.birthDate ? `Geboren ${fmtDay(p.birthDate, "")}` : "Ohne Geburtsdatum"}
                      {p.ridingSince != null ? ` · dabei seit ${p.ridingSince}` : ""}
                      {riderChoices.find((r) => r.id === p.id)?.abos.length
                        ? ` · fährt mit ${riderChoices.find((r) => r.id === p.id)!.abos.join(", ")}`
                        : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${personName(p)} bearbeiten`}
                    className="max-sm:size-11"
                    onClick={() => setStep({ kind: "person", personId: p.id })}
                  >
                    <Pencil />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <SectionHeading title={`Abos (${c.abos.length})`} />
        {c.abos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Abos in diesem Konto.</p>
        ) : (
          <div className="glass-tile divide-y divide-border overflow-hidden">
            {c.abos.map((a) => {
              const rider = a.riderId != null ? c.persons.find((p) => p.id === a.riderId) : null;
              return (
                <div key={a.id} className="flex min-h-11 items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {a.aboName}
                      {!a.running && <Badge variant="neutral">Abgelaufen</Badge>}
                      {a.running && a.status === "PAUSED" && <Badge variant="warning">Pausiert</Badge>}
                      {a.running && a.riderId == null && <Badge variant="warning">Fahrer offen</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      bis {fmtDay(a.endDate)}
                      {rider ? ` · fährt: ${personName(rider)}` : a.riderId == null ? ` · am Abo: ${a.ticketName}` : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Fahrer für ${a.aboName} ändern`}
                    className="max-sm:size-11"
                    onClick={() => setStep({ kind: "rider", aboId: a.id })}
                  >
                    <UserPen />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {canMerge && (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className="max-sm:h-11" onClick={() => setStep({ kind: "merge", fromId: null })}>
            <Merge />
            Mit anderem Konto zusammenlegen
          </Button>
        </div>
      )}
    </>
  );
}

function PersonForm({
  person,
  canDelete,
  onCancel,
  onDone,
  onDeleted,
}: {
  person: CustomerPersonRow;
  /** Admins: Personen ohne Abo löschen. */
  canDelete: boolean;
  onCancel: () => void;
  onDone: () => void;
  onDeleted: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Statistik hängt an den Abos: löschen nur ohne Ticket und ohne eigenen Zugang.
  const deletable = canDelete && person.tickets === 0 && !person.app;
  const [firstName, setFirstName] = useState(person.firstName ?? "");
  const [lastName, setLastName] = useState(person.lastName ?? "");
  const [birthDate, setBirthDate] = useState(person.birthDate ?? "");
  const [ridingSince, setRidingSince] = useState(person.ridingSince != null ? String(person.ridingSince) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = !!(firstName.trim() || lastName.trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/persons/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          birthDate: birthDate || null,
          ridingSince: ridingSince.trim() ? Number(ridingSince) : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Speichern fehlgeschlagen");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={save}>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="person-first">Vorname</Label>
          <Input
            id="person-first"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="off"
            maxLength={80}
            className="max-sm:h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="person-last">Nachname</Label>
          <Input
            id="person-last"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="off"
            maxLength={80}
            className="max-sm:h-11"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="person-birth">Geburtsdatum</Label>
        <Input
          id="person-birth"
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          className="max-sm:h-11"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="person-since">Fährt seit (Jahr)</Label>
        <Input
          id="person-since"
          type="number"
          inputMode="numeric"
          min={1960}
          max={new Date().getFullYear()}
          step={1}
          placeholder="z. B. 2019"
          value={ridingSince}
          onChange={(e) => setRidingSince(e.target.value)}
          className="max-sm:h-11"
        />
        <p className="text-xs text-muted-foreground">
          Erstes Jahr an der Anlage. Zählt bei den Treue-Awards der Kunden-App mit, weil die Starts erst seit 2026 gezählt werden. Leer lassen, wenn unbekannt.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Gilt für alle Abos der Person, an Kasse, Scanner und in der Kunden-App. Die Daten am Abo selbst bleiben.
      </p>
      {canDelete && !deletable && (
        <p className="text-xs text-muted-foreground">
          {person.tickets > 0
            ? "Löschen geht nur bei Personen ohne Abo, weil Starts und Awards am Abo hängen. Fährt eigentlich jemand anderes damit, beim Abo den Fahrer ändern."
            : "Meldet sich selbst in der App an und lässt sich deshalb nicht löschen."}
        </p>
      )}
      {error && <Notice tone="danger" compact title={error} />}
      {confirmDelete ? (
        <ConfirmStep
          title={`${personName(person)} löschen?`}
          description={
            "Mit der Person fährt kein Abo, Starts, Awards und Statistik bleiben unberührt."
            + (person.ridingSince != null ? ` „Dabei seit ${person.ridingSince}“ geht verloren.` : "")
            + (person.family ? " Sie verschwindet auch aus der Familie in der App." : "")
          }
          icon={Trash2}
          onConfirm={async () => {
            const res = await fetch(`/api/customers/persons/${person.id}`, { method: "DELETE" });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) throw new Error(data.error ?? "Löschen fehlgeschlagen");
            onDeleted();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {deletable && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              className="text-destructive hover:text-destructive max-sm:h-11 sm:mr-auto"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
              Person löschen
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy} className="max-sm:h-11" onClick={onCancel}>
            Zurück
          </Button>
          <Button type="submit" disabled={busy || !canSave} className="max-sm:h-11">
            {busy ? <Loader2 className="animate-spin" /> : "Speichern"}
          </Button>
        </div>
      )}
    </form>
  );
}

function MergeStep({
  into,
  rows,
  suggestions,
  fromId,
  onPick,
  onCancel,
  onDone,
}: {
  into: CustomerAccountRow;
  rows: CustomerAccountRow[];
  suggestions: number[];
  fromId: number | null;
  onPick: (id: number | null) => void;
  onCancel: () => void;
  onDone: (message?: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const from = fromId != null ? rows.find((r) => r.id === fromId) ?? null : null;

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const others = rows.filter((r) => r.id !== into.id);
    if (!q) return others.filter((r) => suggestions.includes(r.id));
    return others.filter((r) => matches(r, q)).slice(0, 8);
  }, [rows, into.id, query, suggestions]);

  if (from) {
    return (
      <ConfirmStep
        title={`Konto ${from.email} hierher übernehmen?`}
        description={
          <>
            {holderOf(from)}: {plural(from.abos.length, "Abo", "Abos")} und {plural(from.persons.length, "Person", "Personen")} kommen
            in dieses Konto. Die Adresse bleibt als weitere Adresse, neue Abos damit landen hier. Personen mit
            gleichem Namen und Geburtsdatum werden eins. Das lässt sich nicht rückgängig machen.
          </>
        }
        confirmLabel="Zusammenlegen"
        icon={Merge}
        onCancel={() => onPick(null)}
        onConfirm={async () => {
          const res = await fetch(`/api/customers/${into.id}/merge`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fromId: from.id }),
          });
          const data = (await res.json().catch(() => ({}))) as { error?: string; abos?: number; persons?: number; folded?: number };
          if (!res.ok) throw new Error(data.error ?? "Zusammenlegen fehlgeschlagen");
          const folded = data.folded ? `, ${plural(data.folded, "doppelte Person", "doppelte Personen")} zusammengefasst` : "";
          onDone(`Zusammengelegt: ${plural(data.abos ?? 0, "Abo", "Abos")} und ${plural(data.persons ?? 0, "Person", "Personen")} übernommen${folded}.`);
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery("")}
        placeholder="Anderes Konto suchen (Name oder E-Mail)"
        aria-label="Anderes Konto suchen"
      />
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query.trim() ? "Kein Konto gefunden." : "Such das Konto, das hierher soll."}
        </p>
      ) : (
        <div className="glass-tile divide-y divide-border overflow-hidden">
          {!query.trim() && <p className="px-3 py-2 text-label">Vorschläge</p>}
          {candidates.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.id)}
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-glass-tile focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{holderOf(r)}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="break-all">{r.email}</span> · {plural(r.abos.length, "Abo", "Abos")} · {plural(r.persons.length, "Person", "Personen")}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="max-sm:h-11" onClick={onCancel}>
          Zurück
        </Button>
      </div>
    </div>
  );
}
