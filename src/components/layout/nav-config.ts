import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Building,
  Building2,
  CalendarClock,
  Car,
  Cctv,
  CreditCard,
  Droplets,
  Eye,
  Gift,
  HardDrive,
  IdCard,
  Joystick,
  KeyRound,
  LayoutDashboard,
  Lock,
  Mail,
  MapPin,
  Monitor,
  MonitorCog,
  Network,
  Package,
  PackageSearch,
  QrCode,
  ScanLine,
  Settings,
  Shield,
  ShieldCheck,
  Ticket,
  UserRound,
  Users,
  Volume2,
  Workflow,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  /** Stabiler Schlüssel, unter dem der Auf-/Zuklapp-Zustand gespeichert wird. */
  key: string;
  label: string;
  items: NavItem[];
}

/**
 * Hauptnavigation des Mandanten-Dashboards.
 *
 * Die Gruppen sind Betriebsbereiche, keine technischen Schichten. Ein neues
 * Modul bekommt keinen eigenen Top-Level-Eintrag, sondern wird in den Bereich
 * einsortiert, dessen Frage es beantwortet:
 *
 *  - Übersicht:             Wie läuft der Betrieb gerade, wie lief er?
 *  - Gäste:                 Wer kommt, was hat er gekauft, was gehört ihm?
 *                           (künftig: Kundenkartei, Newsletter, Bewertungen)
 *  - Angebot:               Was verkaufen wir, wo gilt es, wann ist geöffnet?
 *                           (künftig: Preise, Kurse, Verleih, Veranstaltungen)
 *  - Zutritt & Sicherheit:  Wer darf rein, wer ist drin, wer bleibt draußen?
 *                           (künftig: Alarmanlage, Besucherzählung, Notfallplan)
 *  - Gebäude & Technik:     Welche Anlagen laufen, wie werden sie gesteuert?
 *                           (künftig: Energie, Wartung, Heizung/Klima, Parken)
 *  - Personal:              Wer arbeitet hier, mit welchen Rechten und Zeiten?
 *                           (künftig: Schichtplan, Zeiterfassung, Qualifikationen)
 *  - System:                Wie ist das System selbst konfiguriert?
 *                           (künftig: Benutzer & Rollen, Hub-Status, Protokoll)
 *
 * Reihenfolge innerhalb einer Gruppe: Tagesgeschäft oben, Konfiguration unten.
 * Wächst eine Gruppe über etwa acht Einträge, wird sie geteilt, nicht verlängert.
 */
export const navGroups: NavGroup[] = [
  {
    key: "uebersicht",
    label: "Übersicht",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/analytics", label: "Auswertung", icon: BarChart3 },
    ],
  },
  {
    key: "gaeste",
    label: "Gäste",
    items: [
      { href: "/tickets", label: "Tickets", icon: Ticket },
      { href: "/subscriptions", label: "Abos", icon: CreditCard },
      { href: "/vouchers", label: "Gutscheine", icon: Gift },
      { href: "/vereine", label: "Vereine", icon: Users },
      { href: "/lockers", label: "Schließfächer", icon: Lock },
      { href: "/fundsachen", label: "Fundsachen", icon: PackageSearch },
      { href: "/email", label: "E-Mail", icon: Mail },
    ],
  },
  {
    key: "angebot",
    label: "Angebot",
    items: [
      { href: "/services", label: "Services", icon: Package },
      { href: "/areas", label: "Ressourcen", icon: MapPin },
      { href: "/betriebszeiten", label: "Betriebszeiten", icon: CalendarClock },
    ],
  },
  {
    key: "zutritt",
    label: "Zutritt & Sicherheit",
    items: [
      { href: "/monitor", label: "Live-Monitor", icon: Monitor },
      { href: "/scans", label: "Scan-Historie", icon: ScanLine },
      { href: "/scanner", label: "Scanner", icon: QrCode },
      { href: "/schliessanlage", label: "Schließanlage", icon: KeyRound },
      { href: "/ueberwachung", label: "Überwachung", icon: Eye },
      { href: "/personen", label: "Personen", icon: UserRound },
      { href: "/fahrzeuge", label: "Fahrzeuge", icon: Car },
    ],
  },
  {
    key: "technik",
    label: "Gebäude & Technik",
    items: [
      { href: "/raeume", label: "Räume", icon: Building2 },
      { href: "/devices", label: "Geräte", icon: HardDrive },
      { href: "/regeln", label: "Regeln", icon: Workflow },
      { href: "/cameras", label: "Kameras", icon: Cctv },
      { href: "/webcams", label: "Kontrollzentrum", icon: Joystick },
      { href: "/audio", label: "Audio", icon: Volume2 },
      { href: "/bewaesserung", label: "Bewässerung", icon: Droplets },
      { href: "/network", label: "Netzwerk", icon: Network },
    ],
  },
  {
    key: "personal",
    label: "Personal",
    items: [{ href: "/employees", label: "Mitarbeiter", icon: IdCard }],
  },
  {
    key: "system",
    label: "System",
    items: [
      { href: "/monitors", label: "Monitore", icon: MonitorCog },
      { href: "/settings", label: "Einstellungen", icon: Settings },
    ],
  },
];

/** Navigation des Super-Admins (mandantenübergreifend). */
export const adminItems: NavItem[] = [
  { href: "/admin", label: "Admin Dashboard", icon: Shield },
  { href: "/admin/accounts", label: "Mandanten", icon: Building },
];

/**
 * Persönlicher Bereich des angemeldeten Benutzers (Zwei-Faktor, Anmeldung).
 * Steht bewusst nicht in der Hauptnavigation, sondern am Benutzerblock unten.
 */
export const accountItem: NavItem = {
  href: "/sicherheit",
  label: "Konto & Sicherheit",
  icon: ShieldCheck,
};

/**
 * Aktiv ist ein Eintrag nur auf seiner eigenen Route oder darunter.
 * Ein reiner Präfixvergleich ließe „/monitor" auch auf „/monitors" aufleuchten.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
