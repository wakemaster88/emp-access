import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * Monitor-Konfiguration zu einem oeffentlichen Token – pro Request gecacht,
 * damit Layout (Manifest, Titel) und Manifest-Route nicht mehrfach fragen.
 */
export const findPublicMonitor = cache(async (token: string) =>
  prisma.monitorConfig.findUnique({
    where: { token },
    select: { name: true, type: true, isActive: true },
  }),
);
