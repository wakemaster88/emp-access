/** Serialisierte Props der Schliessanlage (Server-Page -> Client-Komponenten). */

export interface LockRow {
  id: number;
  doorId: number;
  lockNumber: string | null;
  lockType: string;
  system: string | null;
  manufacturer: string | null;
  installedAt: string | null;
  notes: string | null;
  keyCount: number;
}

export interface DoorRow {
  id: number;
  roomId: number | null;
  name: string;
  doorNumber: string | null;
  notes: string | null;
  locks: LockRow[];
}

export interface RoomRow {
  id: number;
  name: string;
  number: string | null;
  building: string | null;
  floor: string | null;
  notes: string | null;
  doors: DoorRow[];
}

/** Flache Schloss-Liste fuer Auswahlfelder. */
export interface LockOption {
  id: number;
  label: string;
}

export interface KeyRow {
  id: number;
  keyNumber: string;
  label: string | null;
  level: string;
  status: string;
  notes: string | null;
  lockIds: number[];
  lockLabels: string[];
}

export interface HolderRow {
  id: number;
  ticketId: number | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  displayName: string;
}

/** Mitarbeiter (Ticket mit source EMP_CONTROL) als Auswahloption. */
export interface EmployeeOption {
  id: number;
  name: string;
  email: string | null;
  ticketTypeName: string | null;
}

export interface PolicyRow {
  id: number;
  name: string;
  version: number;
  bodyText: string;
  liabilityText: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface HandoverItemRow {
  id: number;
  keyId: number;
  keyNumber: string;
  keyLabel: string | null;
  level: string;
  itemStatus: string;
  returnedAt: string | null;
}

export interface SignatureRow {
  id: number;
  kind: string;
  token: string;
  expiresAt: string;
  signedAt: string | null;
  signedName: string | null;
  createdAt: string;
}

export interface HandoverRow {
  id: number;
  holderId: number;
  holderName: string;
  holderEmail: string | null;
  issuedAt: string;
  issuedByName: string | null;
  dueAt: string | null;
  deposit: number | null;
  status: string;
  notes: string | null;
  policy: { id: number; name: string; version: number } | null;
  items: HandoverItemRow[];
  signatures: SignatureRow[];
}

export interface SchliessanlageData {
  rooms: RoomRow[];
  /** Tueren ohne Raumzuordnung (Haupteingang, Treppenhaus …). */
  looseDoors: DoorRow[];
  lockOptions: LockOption[];
  keys: KeyRow[];
  holders: HolderRow[];
  employees: EmployeeOption[];
  policies: PolicyRow[];
  handovers: HandoverRow[];
}
