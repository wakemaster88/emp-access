/**
 * Hauptressource ("wo laeuft die Zeit?") fuer Zeit-Tickets.
 *
 * Ein Kombi-Ticket wie "Öffentlicher Betrieb - 1 Stunde" gilt fuer mehrere
 * Bereiche: Seilbahn A (die gebuchte Stunde) UND Strandbad/Insel (Zutritt).
 * Nur die Seilbahn ist die Hauptressource - dort startet der DURATION-Timer
 * und dort wird das Ticket eingeloest. Strandbad und Insel sind Transit:
 * Zutritt ja, aber ohne den Timer anzustossen.
 *
 * Ohne diese Unterscheidung laeuft die gebuchte Stunde schon ab dem
 * Strandbad-Drehkreuz - der Gast verliert Zeit, die er nie genutzt hat.
 */

/** Ticket-Felder, aus denen sich die Hauptressource ableiten laesst. */
export interface MainResourceTicket {
  accessAreaId: number | null;
  service?: { mainAccessAreaId: number | null } | null;
}

/**
 * Die Service-Konfiguration hat Vorrang vor `ticket.accessAreaId`, weil das
 * Ticket-Feld in der Praxis unzuverlaessig ist: der ANNY-Sync setzt es aus
 * dem Resource-Mapping (oft NULL) und manche Tickets tragen versehentlich
 * eine Nebenressource (Strandbad) darin.
 *
 * `null` = keine Hauptressource bestimmbar (z.B. Grillplatz, Abendkarte) -
 * dann zaehlt jeder Scan als verbrauchend (Verhalten vor Einfuehrung der
 * Hauptressourcen).
 */
export function resolveMainAreaId(ticket: MainResourceTicket): number | null {
  return ticket.service?.mainAccessAreaId ?? ticket.accessAreaId;
}

/**
 * Darf dieser Scan das Ticket einloesen und den DURATION-Timer starten?
 *
 * @param mainAreaId  Hauptressource des Tickets (`resolveMainAreaId`).
 * @param scanAreaIds Bereiche, an denen der Scan stattfand. `null` bedeutet
 *   "Ort unbekannt" - z.B. Monitor ohne Bereichs-/Geraetezuordnung oder
 *   Handscanner mit "Alle Bereiche". Dann wird bewusst konservativ
 *   geantwortet: lieber startet der Timer zu spaet (am echten Drehkreuz)
 *   als zu frueh am Eingang. Ein leeres Array wird gleich behandelt.
 */
export function isMainResourceScan(
  mainAreaId: number | null,
  scanAreaIds: number[] | null,
): boolean {
  if (mainAreaId == null) return true;
  if (scanAreaIds == null || scanAreaIds.length === 0) return false;
  return scanAreaIds.includes(mainAreaId);
}
