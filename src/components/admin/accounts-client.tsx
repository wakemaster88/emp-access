"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Building2, Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

interface Account {
  id: number;
  name: string;
  subdomain: string;
  apiToken: string;
  isActive: boolean;
  createdAt: string;
  _count: { admins: number; devices: number; tickets: number; scans: number };
}

interface FormState {
  name: string;
  subdomain: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = { name: "", subdomain: "", isActive: true };

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

  function openCreate() {
    setForm(EMPTY_FORM);
    setError("");
    setShowCreate(true);
  }

  function openEdit(acc: Account) {
    setForm({ name: acc.name, subdomain: acc.subdomain, isActive: acc.isActive });
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
        const res = await fetch(`/api/admin/accounts/${editAccount.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(typeof data.error === "string" ? data.error : "Fehler beim Speichern");
        }
        const updated = await res.json();
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === editAccount.id
              ? { ...a, name: updated.name, subdomain: updated.subdomain, isActive: updated.isActive }
              : a
          )
        );
        setEditAccount(null);
      } else {
        const res = await fetch("/api/admin/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
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
      <Card className="border-slate-200 dark:border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Alle Mandanten ({accounts.length})
          </CardTitle>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Neuer Mandant
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Subdomain</TableHead>
                <TableHead>API Token</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Admins</TableHead>
                <TableHead className="text-right">Geräte</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
                <TableHead className="text-right">Scans</TableHead>
                <TableHead>Erstellt</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-slate-500 py-12">
                    Keine Mandanten vorhanden
                  </TableCell>
                </TableRow>
              )}
              {accounts.map((acc) => (
                <TableRow key={acc.id} className="group">
                  <TableCell className="font-medium">{acc.name}</TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">{acc.subdomain}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => copyToken(acc)}
                      className="flex items-center gap-1 font-mono text-xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {acc.apiToken.slice(0, 12)}...
                      {copiedToken === acc.id ? (
                        <Check className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        acc.isActive
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                      }
                    >
                      {acc.isActive ? "Aktiv" : "Inaktiv"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{acc._count.admins}</TableCell>
                  <TableCell className="text-right">{acc._count.devices}</TableCell>
                  <TableCell className="text-right">{acc._count.tickets}</TableCell>
                  <TableCell className="text-right">{acc._count.scans}</TableCell>
                  <TableCell className="text-sm text-slate-500">{fmtDate(acc.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(acc)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                        onClick={() => setDeleteAccount(acc)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
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
              <p className="text-xs text-slate-500">Nur Kleinbuchstaben, Zahlen und Bindestriche</p>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="isActive">Aktiv</Label>
              <Switch
                id="isActive"
                checked={form.isActive}
                onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
              />
            </div>

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950 dark:text-rose-400 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}
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
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {saving ? "Löschen..." : "Endgültig löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
