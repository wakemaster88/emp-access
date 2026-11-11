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
  /**
   * Weitere Suchbegriffe für die Suche in der Seitenleiste, z. B. was man auf
   * der Seite findet („Klima“ unter Räume). Nur Kleinschreibung nötig.
   */
  keywords?: string[];
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
 *  - Angebot:               Was verkaufen wir, wo gilt es, wann ist geöffnet,
 *                           was zeigen die Anzeigen dazu?
 *                           (künftig: Preise, Kurse, Verleih, Veranstaltungen)
 *  - Zutritt:               Wer darf durch Drehkreuz und Tür, wer war drin?
 *                           (künftig: Besucherzählung)
 *  - Kameras & Sicherheit:  Was sehen die Kameras, wen erkennen sie, wann
 *                           wird gemeldet?
 *                           (künftig: Alarmanlage, Notfallplan)
 *  - Gebäude & Technik:     Welche Anlagen laufen, wie werden sie gesteuert?
 *                           (künftig: Energie, Wartung, Parken)
 *  - Verwaltung:            Wer arbeitet hier, wie ist das System eingestellt?
 *                           (künftig: Schichtplan, Benutzer & Rollen, Protokoll)
 *
 * Reihenfolge innerhalb einer Gruppe: Tagesgeschäft oben, Konfiguration unten.
 * Eine Gruppe hat drei bis sechs Einträge. Wächst sie darüber, wird sie
 * geteilt, nicht verlängert; ein einzelner Eintrag bekommt keine eigene Gruppe.
 * Der Seitentitel (`Header title`) heißt wie der Menüeintrag.
 */
export const navGroups: NavGroup[] = [
  {
    key: "uebersicht",
    label: "Übersicht",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, keywords: ["start", "heute"] },
      { href: "/monitor", label: "Live-Monitor", icon: Monitor, keywords: ["live", "scans", "einlass"] },
      { href: "/analytics", label: "Auswertung", icon: BarChart3, keywords: ["statistik", "analyse", "umsatz"] },
    ],
  },
  {
    key: "gaeste",
    label: "Gäste",
    items: [
      { href: "/tickets", label: "Tickets", icon: Ticket, keywords: ["karten", "gäste", "anny"] },
      { href: "/subscriptions", label: "Abos", icon: CreditCard, keywords: ["abonnement", "mitgliedschaft"] },
      { href: "/vouchers", label: "Gutscheine", icon: Gift },
      { href: "/vereine", label: "Vereine", icon: Users, keywords: ["buchungen", "portal"] },
      { href: "/lockers", label: "Schließfächer", icon: Lock, keywords: ["spind", "fach"] },
      { href: "/fundsachen", label: "Fundsachen", icon: PackageSearch, keywords: ["verloren", "gefunden"] },
    ],
  },
  {
    key: "angebot",
    label: "Angebot",
    items: [
      { href: "/services", label: "Services", icon: Package, keywords: ["leistungen", "produkte"] },
      { href: "/areas", label: "Ressourcen", icon: MapPin, keywords: ["bereiche", "anlagen"] },
      { href: "/betriebszeiten", label: "Betriebszeiten", icon: CalendarClock, keywords: ["öffnungszeiten", "kalender"] },
      { href: "/monitors", label: "Monitore", icon: MonitorCog, keywords: ["anzeigen", "bildschirm", "display"] },
    ],
  },
  {
    key: "zutritt",
    label: "Zutritt",
    items: [
      { href: "/scanner", label: "Scanner", icon: QrCode, keywords: ["qr", "einlass", "prüfen"] },
      { href: "/scans", label: "Scan-Historie", icon: ScanLine, keywords: ["protokoll", "einlass"] },
      { href: "/schliessanlage", label: "Schließanlage", icon: KeyRound, keywords: ["schlüssel", "türen", "übergabe"] },
    ],
  },
  {
    key: "sicherheit",
    label: "Kameras & Sicherheit",
    items: [
      { href: "/ueberwachung", label: "Überwachung", icon: Eye, keywords: ["alarm", "scharf", "bericht"] },
      { href: "/cameras", label: "Kameras", icon: Cctv, keywords: ["zonen", "lieferdienst"] },
      { href: "/webcams", label: "Kontrollzentrum", icon: Joystick, keywords: ["webcam", "ptz", "live", "sirene"] },
      { href: "/personen", label: "Personen", icon: UserRound, keywords: ["erkennung", "sperrliste"] },
      { href: "/fahrzeuge", label: "Fahrzeuge", icon: Car, keywords: ["kennzeichen", "parken", "einfahrt"] },
    ],
  },
  {
    key: "technik",
    label: "Gebäude & Technik",
    items: [
      { href: "/raeume", label: "Räume", icon: Building2, keywords: ["klima", "heizung", "licht", "mähroboter"] },
      { href: "/devices", label: "Geräte", icon: HardDrive, keywords: ["shelly", "drehkreuz", "tor", "relais"] },
      { href: "/regeln", label: "Regeln", icon: Workflow, keywords: ["automation", "szene", "zeitplan"] },
      { href: "/audio", label: "Audio", icon: Volume2, keywords: ["musik", "durchsage", "lautsprecher"] },
      { href: "/bewaesserung", label: "Bewässerung", icon: Droplets, keywords: ["rasen", "beregnung", "wasser"] },
      { href: "/network", label: "Netzwerk", icon: Network, keywords: ["switch", "wlan", "router"] },
    ],
  },
  {
    key: "verwaltung",
    label: "Verwaltung",
    items: [
      { href: "/employees", label: "Mitarbeiter", icon: IdCard, keywords: ["personal", "team"] },
      { href: "/email", label: "E-Mail", icon: Mail, keywords: ["versand", "automation", "anfragen"] },
      { href: "/settings", label: "Einstellungen", icon: Settings, keywords: ["konto", "api", "integration"] },
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
