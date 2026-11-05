"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Building2, Copy, Check, Users, Loader2, Eye, EyeOff, ShieldCheck, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Account {
  id: number;
  name: string;
  subdomain: string;
  apiToken: string;
  isActive: boolean;
  createdAt: string;
  _count: { admins: number; devices: number; tickets: number; scans: number };
}

interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: string;
  lastLogin: string | null;
  createdAt: string;
  twoFactorEnabledAt: string | null;
}

interface FormState {
  name: string;
  subdomain: string;
  isActive: boolean;
  /** Nur beim Bearbeiten: leer = Token unverändert */
  apiToken: string;
}

interface UserFormState {
  name: string;
  email: string;
  password: string;
  role: string;
}

const EMPTY_FORM: FormState = { name: "", subdomain: "", isActive: true, apiToken: "" };
const EMPTY_USER_FORM: UserFormState = { name: "", email: "", password: "", role: "USER" };

export function AccountsClient({ accounts: initial }: { accounts: Account[] }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState(initial);
  const [showCreate, setShowCreate] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [deleteAccount, setDeleteAccount] = useState<Account | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copiedToken, setCopiedToken] = useState<number | null>(null);

  const [usersAccount, setUsersAccount] = useState<Account | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [resetTwoFactorUser, setResetTwoFactorUser] = useState<AdminUser | null>(null);
  const [userForm, setUserForm] = useState<UserFormState>(EMPTY_USER_FORM);
  const [userSaving, setUserSaving] = useState(false);
  const [userError, setUserError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  function openCreate() {
    setForm(EMPTY_FORM);
    setError("");
    setShowCreate(true);
  }

  function openEdit(acc: Account) {
    setForm({ name: acc.name, subdomain: acc.subdomain, isActive: acc.isActive, apiToken: "" });
    setError("");
    setEditAccount(acc);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.subdomain.trim()) {
      setError("Name und Subdomain sind erforderlich");
      return;
    }
    if (!/^[a-z0-9-]+$/.test(form.subdomain)) {
      setError("Subdomain: nur Kleinbuchstaben, Zahlen und Bindestriche");
      return;
    }

    setSaving(true);
    setError("");

    try {
      if (editAccount) {
        const payload: Record<string, unknown> = {
          name: form.name.trim(),
          subdomain: form.subdomain.trim(),
          isActive: form.isActive,
        };
        if (form.apiToken.trim().length >= 16) {
          payload.apiToken = form.apiToken.trim();
        }
        const res = await fetch(`/api/admin/accounts/${editAccount.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(typeof data.error === "string" ? data.error : "Fehler beim Speichern");
        }
        const updated = await res.json();
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === editAccount.id
              ? {
                  ...a,
                  name: updated.name,
                  subdomain: updated.subdomain,
                  isActive: updated.isActive,
                  apiToken: updated.apiToken ?? a.apiToken,
                }
              : a
          )
        );
        setEditAccount(null);
      } else {
        const res = await fetch("/api/admin/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            subdomain: form.subdomain.trim(),
            isActive: form.isActive,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(typeof data.error === "string" ? data.error : "Fehler beim Erstellen");
        }
        setShowCreate(false);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteAccount) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/accounts/${deleteAccount.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Fehler beim Löschen");
      setAccounts((prev) => prev.filter((a) => a.id !== deleteAccount.id));
      setDeleteAccount(null);
    } catch {
      setError("Fehler beim Löschen");
    } finally {
      setSaving(false);
    }
  }

  const openUsers = useCallback(async (acc: Account) => {
    setUsersAccount(acc);
    setUsersLoading(true);
    try {
      const res = await fetch(`/api/admin/accounts/${acc.id}/users`);
      if (res.ok) setUsers(await res.json());
    } finally {
      setUsersLoading(false);
    }
  }, []);

  function openCreateUser() {
    setUserForm(EMPTY_USER_FORM);
    setUserError("");
    setShowPassword(false);
    setEditUser(null);
    setShowUserForm(true);
  }

  function openEditUser(u: AdminUser) {
    setUserForm({ name: u.name, email: u.email, password: "", role: u.role });
    setUserError("");
    setShowPassword(false);
    setEditUser(u);
    setShowUserForm(true);
  }

  async function handleUserSave() {
    if (!usersAccount) return;
    if (!userForm.name.trim() || !userForm.email.trim()) {
      setUserError("Name und E-Mail sind erforderlich");
      return;
    }
    if (!editUser && userForm.password.length < 6) {
      setUserError("Passwort muss mindestens 6 Zeichen haben");
      return;
    }

    setUserSaving(true);
    setUserError("");

    try {
      const payload: Record<string, string> = {
        name: userForm.name,
        email: userForm.email,
        role: userForm.role,
      };
      if (userForm.password) payload.password = userForm.password;

      if (editUser) {
        const res = await fetch(`/api/admin/accounts/${usersAccount.id}/users/${editUser.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(typeof data.error === "string" ? data.error : "Fehler beim Speichern");
        }
        const updated = await res.json();
        setUsers((prev) => prev.map((u) => (u.id === editUser.id ? updated : u)));
      } else {
        if (!userForm.password) {
          setUserError("Passwort ist erforderlich");
          setUserSaving(false);
          return;
        }
        payload.password = userForm.password;
        const res = await fetch(`/api/admin/accounts/${usersAccount.id}/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(typeof data.error === "string" ? data.error : "Fehler beim Erstellen");
        }
        const created = await res.json();
        setUsers((prev) => [...prev, created]);
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === usersAccount.id
              ? { ...a, _count: { ...a._count, admins: a._count.admins + 1 } }
              : a
          )
        );
      }
      setShowUserForm(false);
      setEditUser(null);
    } catch (e) {
      setUserError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setUserSaving(false);
    }
  }

  async function handleUserDelete() {
    if (!usersAccount || !deleteUser) return;
    setUserSaving(true);
    try {
      const res = await fetch(`/api/admin/accounts/${usersAccount.id}/users/${deleteUser.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(typeof data.error === "string" ? data.error : "Fehler beim Löschen");
      }
      setUsers((prev) => prev.filter((u) => u.id !== deleteUser.id));
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === usersAccount.id
            ? { ...a, _count: { ...a._count, admins: Math.max(0, a._count.admins - 1) } }
            : a
        )
      );
      setDeleteUser(null);
    } catch {
      setUserError("Fehler beim Löschen");
    } finally {
      setUserSaving(false);
    }
  }

  async function handleTwoFactorReset() {
    if (!usersAccount || !resetTwoFactorUser) return;
    setUserSaving(true);
    try {
      const res = await fetch(
        `/api/admin/accounts/${usersAccount.id}/users/${resetTwoFactorUser.id}/two-factor`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(typeof data.error === "string" ? data.error : "Fehler beim Zurücksetzen");
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === resetTwoFactorUser.id ? { ...u, twoFactorEnabledAt: null } : u))
      );
      setResetTwoFactorUser(null);
    } catch (e) {
      setUserError(e instanceof Error ? e.message : "Fehler beim Zurücksetzen");
    } finally {
      setUserSaving(false);
    }
  }

  function copyToken(acc: Account) {
    navigator.clipboard.writeText(acc.apiToken);
    setCopiedToken(acc.id);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
  }

  const dialogOpen = showCreate || !!editAccount;

  return (
    <>
      {/* Tabelle läuft unten bis an den Kartenrand (docs/design-regeln.md, Abschnitt 17). */}
      <Card className="overflow-hidden pb-0 sm:pb-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 tabular-nums">
            <Building2 className="h-4 w-4 text-primary" />
            Alle Mandanten ({accounts.length})
          </CardTitle>
          <Button onClick={openCreate} size="sm" className="max-sm:h-11">
            <Plus className="h-4 w-4" />
            Neuer Mandant
          </Button>
        </CardHeader>
        {/* Erste und letzte Spalte rücken auf den Innenabstand der Karte ein; breite Tabellen scrollen im Container. */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4 sm:pl-[18px]">Name</TableHead>
              <TableHead>Subdomain</TableHead>
              <TableHead>API Token</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Admins</TableHead>
              <TableHead className="text-right">Geräte</TableHead>
              <TableHead className="text-right">Tickets</TableHead>
              <TableHead className="text-right">Scans</TableHead>
              <TableHead>Erstellt</TableHead>
              <TableHead className="w-[100px] pr-4 sm:pr-[18px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="p-0 whitespace-normal">
                  <EmptyState icon={Building2} title="Keine Mandanten vorhanden" />
                </TableCell>
              </TableRow>
            )}
            {accounts.map((acc) => (
              <TableRow key={acc.id} className="group">
                <TableCell className="font-medium pl-4 sm:pl-[18px]">{acc.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{acc.subdomain}</TableCell>
                <TableCell>
                  <button
                    onClick={() => copyToken(acc)}
                    className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors max-sm:min-h-11"
                  >
                    {acc.apiToken.slice(0, 12)}...
                    {copiedToken === acc.id ? (
                      <Check className="h-3 w-3 text-success" />
                    ) : (
                      // Mit Maus erst beim Darüberfahren, auf Touch-Geräten immer sichtbar.
                      <Copy className="h-3 w-3 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100" />
                    )}
                  </button>
                </TableCell>
                <TableCell>
                  <Badge variant={acc.isActive ? "success" : "neutral"}>
                    {acc.isActive ? "Aktiv" : "Inaktiv"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{acc._count.admins}</TableCell>
                <TableCell className="text-right tabular-nums">{acc._count.devices}</TableCell>
                <TableCell className="text-right tabular-nums">{acc._count.tickets}</TableCell>
                <TableCell className="text-right tabular-nums">{acc._count.scans}</TableCell>
                <TableCell className="text-sm text-muted-foreground tabular-nums">{fmtDate(acc.createdAt)}</TableCell>
                <TableCell className="pr-4 sm:pr-[18px]">
                  {/* Mit Maus erst beim Darüberfahren oder Fokus, auf Touch-Geräten immer sichtbar. */}
                  <div className="flex items-center gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-within:opacity-100">
                    <Button variant="ghost" size="icon-sm" className="max-sm:size-11" onClick={() => openUsers(acc)} title="Benutzer verwalten" aria-label="Benutzer verwalten">
                      <Users className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="max-sm:size-11" onClick={() => openEdit(acc)} title="Mandant bearbeiten" aria-label="Mandant bearbeiten">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 max-sm:size-11"
                      onClick={() => setDeleteAccount(acc)}
                      title="Mandant löschen"
                      aria-label="Mandant löschen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setShowCreate(false); setEditAccount(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editAccount ? "Mandant bearbeiten" : "Neuer Mandant"}</DialogTitle>
            <DialogDescription>
              {editAccount
                ? "Änderungen am bestehenden Mandanten vornehmen."
                : "Einen neuen Mandanten anlegen. Subdomain muss eindeutig sein."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Firmenname"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subdomain">Subdomain</Label>
              <Input
                id="subdomain"
                placeholder="firma-xyz"
                value={form.subdomain}
                onChange={(e) => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
              />
              <p className="text-xs text-muted-foreground">Nur Kleinbuchstaben, Zahlen und Bindestriche</p>
            </div>

            {/* Option im Formular, wirkt erst beim Speichern: Kästchen statt Schalter (Abschnitt 14). */}
            <div className="flex items-center gap-2 max-sm:min-h-11">
              <Checkbox
                id="isActive"
                checked={form.isActive}
                onCheckedChange={(checked) => setForm({ ...form, isActive: checked === true })}
              />
              <Label htmlFor="isActive" className="cursor-pointer">Aktiv</Label>
            </div>

            {editAccount && (
              <div className="space-y-2">
                <Label htmlFor="apiToken">API-Token (optional)</Label>
                <Input
                  id="apiToken"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Leer lassen = unverändert; min. 16 Zeichen zum Setzen"
                  value={form.apiToken}
                  onChange={(e) => setForm({ ...form, apiToken: e.target.value })}
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Mandanten-Token für Raspberry Pi, Shelly und eigene API. Nach Änderung Geräte aktualisieren.
                </p>
              </div>
            )}

            {error && <Notice tone="danger" compact title={error} />}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowCreate(false); setEditAccount(null); }}
            >
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Speichern..." : editAccount ? "Speichern" : "Anlegen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteAccount} onOpenChange={(open) => { if (!open) setDeleteAccount(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mandant löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Mandant <strong>{deleteAccount?.name}</strong> und alle zugehörigen Daten
              (Admins, Geräte, Tickets, Scans) werden unwiderruflich gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              variant="destructive"
            >
              {saving ? "Löschen..." : "Endgültig löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Users Management Dialog – tritt zurück, solange Formular oder Rückfrage offen ist (höchstens eine Ebene, Abschnitt 18). */}
      <Dialog
        open={!!usersAccount && !showUserForm && !deleteUser && !resetTwoFactorUser}
        onOpenChange={(open) => { if (!open) setUsersAccount(null); }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            {/* Auf dem Handy mittig wie die Beschreibung darunter (DialogHeader), ab sm linksbündig. */}
            <DialogTitle className="flex items-center justify-center gap-2 sm:justify-start">
              <Users className="h-5 w-5" />
              Benutzer — {usersAccount?.name}
            </DialogTitle>
            <DialogDescription>
              Benutzer dieses Mandanten verwalten.
            </DialogDescription>
          </DialogHeader>

          {usersLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Lädt …
            </div>
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>E-Mail</TableHead>
                    <TableHead>Rolle</TableHead>
                    <TableHead>2FA</TableHead>
                    <TableHead>Letzter Login</TableHead>
                    <TableHead className="w-[140px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="p-0 whitespace-normal">
                        <EmptyState compact icon={Users} title="Keine Benutzer vorhanden" />
                      </TableCell>
                    </TableRow>
                  )}
                  {users.map((u) => (
                    <TableRow key={u.id} className="group">
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                      <TableCell>
                        {/* Rolle Admin weich in Akzentfarbe: die Pille hat dafür keine eigene Variante. */}
                        <Badge
                          variant={u.role === "ADMIN" ? "default" : "neutral"}
                          className={u.role === "ADMIN" ? "bg-primary/10 text-primary" : undefined}
                        >
                          {u.role === "ADMIN" ? "Admin" : "Benutzer"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {u.twoFactorEnabledAt ? (
                          <span className="inline-flex items-center gap-1 text-sm text-success">
                            <ShieldCheck className="h-4 w-4" />
                            Aktiv
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {u.lastLogin
                          ? new Date(u.lastLogin).toLocaleString("de-DE", {
                              day: "2-digit", month: "2-digit", year: "numeric",
                              hour: "2-digit", minute: "2-digit",
                            })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {/* Mit Maus erst beim Darüberfahren oder Fokus, auf Touch-Geräten immer sichtbar. */}
                        <div className="flex items-center gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-within:opacity-100">
                          <Button variant="ghost" size="icon-sm" className="max-sm:size-11" onClick={() => openEditUser(u)} title="Benutzer bearbeiten" aria-label="Benutzer bearbeiten">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {u.twoFactorEnabledAt && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-warning hover:text-warning hover:bg-warning/10 max-sm:size-11"
                              title="Zwei-Faktor zurücksetzen"
                              aria-label="Zwei-Faktor zurücksetzen"
                              onClick={() => setResetTwoFactorUser(u)}
                            >
                              <ShieldOff className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 max-sm:size-11"
                            onClick={() => setDeleteUser(u)}
                            title="Benutzer löschen"
                            aria-label="Benutzer löschen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Button onClick={openCreateUser} size="sm" className="w-full">
                <Plus className="h-4 w-4" />
                Neuer Benutzer
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create / Edit User Dialog */}
      <Dialog open={showUserForm} onOpenChange={(open) => { if (!open) { setShowUserForm(false); setEditUser(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editUser ? "Benutzer bearbeiten" : "Neuer Benutzer"}</DialogTitle>
            <DialogDescription>
              {editUser
                ? "Benutzerdaten ändern. Passwort leer lassen, um es nicht zu ändern."
                : `Neuen Benutzer für ${usersAccount?.name} anlegen.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="userName">Name</Label>
              <Input
                id="userName"
                placeholder="Max Mustermann"
                value={userForm.name}
                onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="userEmail">E-Mail</Label>
              <Input
                id="userEmail"
                type="email"
                placeholder="max@firma.de"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="userPassword">
                Passwort{editUser ? " (leer = unverändert)" : ""}
              </Label>
              <div className="relative">
                <Input
                  id="userPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder={editUser ? "••••••••" : "Mindestens 6 Zeichen"}
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  className="pr-10"
                />
                {/* Taste über dem Glasfeld (z-10), sonst liegt sie unter dessen Fläche. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 z-10 h-full w-10"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="userRole">Rolle</Label>
              <Select value={userForm.role} onValueChange={(v) => setUserForm({ ...userForm, role: v })}>
                <SelectTrigger id="userRole" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">Benutzer</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {userError && <Notice tone="danger" compact title={userError} />}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowUserForm(false); setEditUser(null); }}>
              Abbrechen
            </Button>
            <Button onClick={handleUserSave} disabled={userSaving}>
              {userSaving ? "Speichern..." : editUser ? "Speichern" : "Anlegen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation */}
      <AlertDialog open={!!deleteUser} onOpenChange={(open) => { if (!open) setDeleteUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Benutzer löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Benutzer <strong>{deleteUser?.name}</strong> ({deleteUser?.email}) wird
              unwiderruflich gelöscht und kann sich nicht mehr anmelden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUserDelete}
              variant="destructive"
            >
              {userSaving ? "Löschen..." : "Endgültig löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset 2FA Confirmation */}
      <AlertDialog
        open={!!resetTwoFactorUser}
        onOpenChange={(open) => { if (!open) setResetTwoFactorUser(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zwei-Faktor zurücksetzen?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{resetTwoFactorUser?.name}</strong> ({resetTwoFactorUser?.email}) meldet sich danach
              wieder nur mit Passwort an. Bitte erst zurücksetzen, wenn zweifelsfrei feststeht, wer da fragt –
              und den Benutzer bitten, die Zwei-Faktor-Anmeldung sofort neu einzurichten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTwoFactorReset}
              variant="destructive"
            >
              {userSaving ? "Zurücksetzen..." : "Zurücksetzen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
