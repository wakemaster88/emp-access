# Entscheidungen

Grundsatzentscheidungen, die man aus dem Code allein nicht ablesen kann.
Neueste unten in jedem Abschnitt.

## Cloud führt, Hub spiegelt (03.11.2026)

Räume, Geräte, Regeln, Klima und Zeitpläne werden nur in der Web-App
(Cloud) gepflegt: `KeyRoom`, `Device`, `RoomRule`, `RoomClimate`. Der Hub
holt sich die Konfiguration, zeigt „Räume“ an, schaltet Geräte im LAN,
führt Regeln weiter aus, wenn die Cloud nicht erreichbar ist, und ändert
Regeln nur über einen Proxy zur Cloud (PR #20–#22).

**Warum:** Konfiguration nicht doppelt pflegen, trotzdem schnell und
offline-fähig. **Folge:** Keinen eigenen Konfigurationsspeicher im Hub
anlegen, immer aus der Cloud synchronisieren.

## Hub bleibt im Management-VLAN (03.11.2026)

Der Hub hängt nur in VLAN 1 und erreicht Kameras, IoT und Anlage über das
Inter-VLAN-Routing des Routers. Die isolierten VLANs lassen per
Traffic-Regel nur die Hub-Adresse herein. Der ursprünglich geplante
Trunk-Port mit macOS-VLAN-Interfaces (`hub/install/setup-vlans.sh`) ist nur
noch eine Option. Kameras und DoorBird findet der Hub über ihre MAC wieder,
wenn sich die IP ändert (PR #10).

## Netzwerk konfiguriert Insight, der Hub liest nur

NETGEAR Insight hat keine offizielle Konfigurations-API. Der Hub schreibt
deshalb keine Router-, Switch- oder WLAN-Konfiguration, sondern liest per
SNMP mit (Ports, VLANs, MAC-Tabellen, Fehlerzähler). Auch die Sperrliste
für Geräte (PR #92) dokumentiert nur und warnt; das eigentliche Sperren
passiert von Hand in Insight (SSID → MAC-ACL, Richtlinie „Verbieten“).
Das Nachspielen von Insight-Sitzungstokens wurde bewusst abgelehnt.

## Eigener Telegram-Bot für den Hub-Assistenten (05.11.2026)

Der Hub-Assistent (lokales Modell über Ollama) hat einen eigenen Bot, nicht
den Alarm-Bot der Cloud, weil ein Bot nur einen Empfangsweg haben kann.
Lesende Werkzeuge laufen sofort; alles, was schaltet, braucht einen Knopf
„Ausführen“. Netzwerk-Änderungen und freie Shell-Befehle bekommt der
Assistent nie.

## Lieferdienste erst melden, dann öffnen (04.11.2026)

Die Lieferdienst-Erkennung an der Einfahrt läuft zuerst im Modus „Melden“,
nicht „Tor öffnen“. Grund: Fälschungsgefahr und Subunternehmer-Transporter
ohne Aufschrift. Vor dem Umschalten Treffer und Fehltreffer mit Aaron
durchsehen (Hub-Log „Lieferdienst“, `VehicleSighting.deliveryBrand`).

## Mammotion nur über ein Zweitkonto mit Sitzungs-Cache (04.11.2026)

Mammotion sperrt Konten bei wiederholten Passwort-Logins. Der Mäher-Dienst
meldet sich einmal an, hält die Sitzung in `hub/mower/.cache/session.json`,
merkt sich abgelehnte Zugangsdaten und probiert sie nie wieder. Die Mäher
sind für das Zweitkonto freigegeben, nicht daran gebunden. Die
Mäher-Kamera kommt nur in der Großansicht der Zentrale, weil jede
Verbindung die Kamera am Mäher einschaltet.

## emp-control nur über den Live-Monitor-Link (05.11.2026)

emp-control (Personal, Zeiterfassung, Schichten) ist eine eigene App mit
eigener Datenbank. Die Cloud liest nur deren Live-Monitor
(`/api/monitor/live?token=…`, Link in Einstellungen → emp-control); der Hub
fragt die Cloud über `/api/hub/staff`. **Keinen** direkten Datenbankzugriff
vom Hub auf emp-control einbauen, sondern `/api/hub/staff` erweitern.

## Ein Design-Regelwerk, Liquid-Glass-Optik (04./05.11.2026)

Aaron möchte die Oberfläche „cleaner, Richtung iOS 26/27 Liquid Glass“.
Einziges Regelwerk ist [`docs/design-regeln.md`](../design-regeln.md); kein
zweites anlegen. Auf dem Handy scrollt nichts seitlich (keine Seite, keine
Tab-Leiste, keine Tabelle bei 360 px). Seiten nur mit den Bausteinen aus
`src/components/ui` umbauen, keine eigenen Grautöne oder Karten.

## Gesichtserkennung und Datenschutz

Keine Kameras in Umkleiden und WCs; Belegung dort nur über Türzähler oder
Bewegungsmelder. Wiedererkennung über Kameras hinweg merkt sich nur eine
Kleidungsbeschreibung für 8 Stunden, kein Bild und kein Gesichtsmerkmal.
Ob die Gesichtserkennung auch auf gezoomte Nahaufnahmen laufen soll,
entscheidet Aaron (DSGVO), siehe [offene Punkte](offene-punkte.md).

## Hub-Maschine: frisch aufgesetzt statt migriert (05.11.2026)

Der Mac Studio wurde ohne Migrationsassistent eingerichtet. Übernommen
wurden gezielt `hub/.env`, `hub/.tls` (damit iPhones der lokalen CA weiter
vertrauen), `hub/.cache`, `hub/mower/.cache`, `webcams/config.json` und
`webcams/infra/go2rtc.yaml`. Er hat die Adresse des iMac übernommen und
behält den bisherigen `HUB_NAME`, damit der Hub-Eintrag in der Cloud samt
Verlauf bleibt. Nie zwei Hubs mit demselben Namen gleichzeitig laufen
lassen; sie nehmen sich gegenseitig die Aufgaben weg.
