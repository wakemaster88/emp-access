/**
 * Genehmigung eines wiederkehrenden Fahrzeugs per Telegram (reine Logik):
 * welche DoorBird der Hub mitschickt und was die Texte versprechen.
 *
 * Das Tor öffnet nur für Fahrzeuge mit zugewiesener DoorBird. Ist genau eine
 * DoorBird eingerichtet, schickt der Hub ihre ID mit der Genehmigung mit;
 * das automatische Öffnen versprechen Frage und Antwort nur in diesem Fall,
 * die Antwort nur, wenn die Cloud die DoorBird beim Anlegen übernommen hat.
 * Eine Cloud, die das Feld nicht kennt, legt das Fahrzeug ohne DoorBird an.
 */

/** DoorBird für die Genehmigung: nur wenn genau eine eingerichtet ist. */
export function approvalDoorbird(doorbirdIds: readonly number[]): number | null {
  return doorbirdIds.length === 1 ? doorbirdIds[0] : null;
}

/** Inhalt für POST /api/hub/allowed-vehicles. */
export function approvalBody(plate: string, cameraId: number | null, doorbirdId: number | null): Record<string, unknown> {
  const body: Record<string, unknown> = { plate };
  if (cameraId != null) body.cameraId = cameraId;
  if (doorbirdId != null) body.doorbirdCameraId = doorbirdId;
  return body;
}

/** Hat die Cloud das Fahrzeug mit der mitgeschickten DoorBird angelegt? */
export function approvedWithDoorbird(created: unknown, doorbirdId: number | null): boolean {
  if (doorbirdId == null || !created || typeof created !== "object") return false;
  return (created as { doorbirdCameraId?: unknown }).doorbirdCameraId === doorbirdId;
}

/**
 * Nochmals ohne DoorBird senden? Nur wenn die Cloud genau die mitgeschickte
 * DoorBird ablehnt; die Genehmigung gelingt dann wie bisher ohne Türöffnung.
 */
export function retryWithoutDoorbird(status: number, error: unknown, body: Record<string, unknown>): boolean {
  return status === 400 && body.doorbirdCameraId != null && error === "DoorBird nicht gefunden";
}

/** Satz nach „Auf die genehmigte Liste setzen?“ in der Frage. */
export function approvalQuestion(doorbirdId: number | null, atCamera: boolean): string {
  if (doorbirdId == null) {
    return (
      `Dann gibt es dafür keinen Alarm mehr. Das Tor öffnet dafür nicht automatisch, ` +
      `solange in der Fahrzeugverwaltung keine DoorBird zugewiesen ist.`
    );
  }
  return (
    `Dann gibt es dafür keinen Alarm mehr, und das Tor kann sich bei Erkennung` +
    `${atCamera ? " an dieser Kamera" : ""} automatisch öffnen.`
  );
}

/** Antwort nach erfolgreicher Genehmigung. */
export function approvedText(plate: string, cameraName: string | null, opens: boolean): string {
  const head = `✅ ${plate} ist genehmigt${cameraName ? ` (Kamera ${cameraName})` : ""}. Kein Alarm mehr für dieses Fahrzeug`;
  return opens
    ? `${head}, das Tor öffnet bei Erkennung automatisch.`
    : `${head}. Automatisch öffnet das Tor erst, wenn in der Fahrzeugverwaltung eine DoorBird zugewiesen ist.`;
}
