import type { z } from "zod";
import type { lostItemCreateSchema, lostItemUpdateSchema } from "@/lib/validators";

type CreateInput = z.infer<typeof lostItemCreateSchema>;
type UpdateInput = z.infer<typeof lostItemUpdateSchema>;

export function resolveLostItemKind(kind: CreateInput["kind"] | undefined): "FOUND" | "LOST_REPORT" {
  return kind === "LOST_REPORT" ? "LOST_REPORT" : "FOUND";
}

export function buildLostItemCreateData(data: CreateInput, accountId: number) {
  const kind = resolveLostItemKind(data.kind);
  const pickedUp = data.pickedUp ?? false;

  return {
    kind,
    description: data.description.trim(),
    foundDate: new Date(data.foundDate ?? new Date().toISOString().slice(0, 10)),
    image: kind === "FOUND" ? (data.image ?? null) : null,
    contact: kind === "FOUND" ? (data.contact?.trim() || null) : null,
    reporterName: kind === "LOST_REPORT" ? (data.reporterName?.trim() || null) : null,
    callbackPhone: kind === "LOST_REPORT" ? (data.callbackPhone?.trim() || null) : null,
    pickedUp,
    pickedUpAt: pickedUp ? new Date() : null,
    accountId,
  };
}

export function buildLostItemUpdateData(
  data: UpdateInput,
  existing: { kind: "FOUND" | "LOST_REPORT"; pickedUp: boolean; pickedUpAt: Date | null }
) {
  const kind = data.kind !== undefined ? resolveLostItemKind(data.kind) : existing.kind;

  return {
    ...(data.kind !== undefined && { kind }),
    ...(data.description !== undefined && { description: data.description.trim() }),
    ...(data.foundDate !== undefined && { foundDate: new Date(data.foundDate) }),
    ...(data.image !== undefined && kind === "FOUND" && { image: data.image }),
    ...(data.contact !== undefined && kind === "FOUND" && { contact: data.contact?.trim() || null }),
    ...(data.reporterName !== undefined && kind === "LOST_REPORT" && {
      reporterName: data.reporterName?.trim() || null,
    }),
    ...(data.callbackPhone !== undefined && kind === "LOST_REPORT" && {
      callbackPhone: data.callbackPhone?.trim() || null,
    }),
    ...(data.pickedUp !== undefined && {
      pickedUp: data.pickedUp,
      pickedUpAt: data.pickedUp ? (existing.pickedUpAt ?? new Date()) : null,
    }),
  };
}