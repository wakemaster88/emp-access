# Offene Punkte

Stand 8. November 2026. Erledigtes bitte streichen.

## Wartet auf Aarons OK oder Entscheidung

- Lieferdienst-Erkennung an der Einfahrt von „Melden“ auf „Tor öffnen“
  umstellen (nach Durchsicht der Treffer).
- NTP an den Kameras einschalten; alle Substreams von 10 auf 15 fps;
  Hauptstreams der RLC-811A von H.265 auf H.264.
- Netzwerk-Audit vom 03.11.: Traffic-Regel Verwaltung → Management sperren,
  Switch-Adressen in Client-VLANs entfernen, SSIDs zusammenlegen
  (Kassensystem2, Sound), NETGEAR-Supportzugriff in Insight beenden,
  DHCP-Snooping.
- SSIDs TwinCable und Sound nach VLAN 41 verschieben (erst klären, welche
  Geräte in TwinCable hängen).
- Verhaltens-Befunde aus dem Design-Durchgang: Kiosk „Stornieren &
  Gutschein“ ohne Rückfrage, `alert()` bei Kiosk-Fehlern, Kiosk-Overlays
  ohne Dialog-Semantik, `/m`-Fehlertext nie sichtbar, Fehler-Scans fehlen in
  „Letzte Scans“, „13.63 m³“ mit Punkt, Ventile offline mit aktiver Taste,
  `flash()` blendet Fehler nach 4 s aus.
- MCP-Schnittstelle: Dürfen Türen und Tore über MCP geschaltet werden
  (Stufe `access`, `MCP_OFFERED_LEVELS`)?
- Vereinsportal: Soll der Zugang nur außerhalb der Betriebszeit gelten?

## Hub-Maschine

- Time Machine hat kein Ziel; `.env`, `.tls` und Kamera-Konfiguration sind
  nicht gesichert (Vorschlag: Freigabe auf der Synology).
- Log-Kürzung als LaunchAgent laden, SSH-Schlüssel hinterlegen und dann
  Passwort-Login per SSH abschalten.
- Zentrale-Kacheln bleiben in Safari schwarz (Chrome zeigt Bild), Ursache
  offen.
- iMac nach einer Woche ohne Probleme löschen; verwaisten Hub-Eintrag des
  iMac in der Cloud entfernen.
- `webcams/config.json` mit `go2rtc.yaml` abgleichen (siehe
  [Hub-Betrieb](hub-betrieb.md#streams-und-zentrale)).

## Netzwerk und Geräte

- Seilbahn-A/B-Kameras und beide Soundweb-Prozessoren sind nicht
  erreichbar.
- SNMP des Routers antwortet dem Hub nicht.
- 2,4-GHz-Kanäle überlappen teils; ggf. fest auf 1/6/11.
- Restliche Audit-Punkte: Port des Soundweb am Core, Ports der
  Buchhaltung, Kabel mit CRC-Fehlern, Reservierungs-MACs der Switches.
- Backup-Leitung (5G/LTE an WAN2) und später PR60X direkt am VDSL-Modem
  (PPPoE, VLAN 7) statt doppeltem NAT.
- Ersatz der EOL-Geräte (WAC505, WAC540, GC110P) in 1–2 Jahren.

## Cloud

- Account hat keine Koordinaten; das Cloud-Wetter fällt auf Berlin zurück
  (der Hub nutzt `HUB_LAT`/`HUB_LON`).
- Belegungs-Schwellen sind geraten, Kalibrierung erst mit dem Saisonbetrieb.
- Räume: aus dem Konzept noch offen sind Anwesenheit als Auslöser,
  Benachrichtigung am Widget, Verlauf und Energie für alle Sensoren, Rollen
  je Raum und Szenen-Kacheln auf der Übersicht.
- Fehlende Geräte in der Datenbank: Licht und Bewegungsmelder Umkleide
  Damen (Import über Shelly Cloud), Hue-Bridges noch nicht gekoppelt.
- Mammotion: Luba 2 läuft über die ältere Aliyun-Cloud, Befehle an sie sind
  ungetestet; ihr Refresh-Token ist abgelaufen.
