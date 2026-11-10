# Netzwerk

Allgemeiner Aufbau und Eigenheiten der Geräte. Adressen, MACs,
Port-Belegung und Firewall-Regeln stehen in
[standort-details.md](standort-details.md).

## Aufbau

- **Internet:** Telekom VDSL über eine FRITZ!Box 7590 (sie ist das Modem und
  macht die Telefonie). Der Router NETGEAR PR60X hängt dahinter (doppeltes
  NAT, bewusst so belassen). Das öffentliche Gäste-WLAN wird extern
  betreut und hängt direkt an der FRITZ!Box, nicht am PR60X.
- **Router:** PR60X seit 03.11.2026 (ersetzt den BR500). Gateway und DHCP
  für alle VLANs, WireGuard für den Fernzugang (Split-Tunnel).
- **Verwaltung:** alles über NETGEAR Insight (14 Access Points, 10 Switches,
  Core-Switch GC752XP im Technikraum).
- **Speicher:** zwei Synology-NAS als Cluster.

## VLANs

Schema: VLAN-ID = drittes Oktett des Netzes, Gateway immer `.1`.

| VLAN | Rolle | Internet | Hinweis |
| --- | --- | --- | --- |
| 1 | Management + Hub | ja | Router, Switches, APs, Hub, DoorBird |
| 20 | Kassensystem | ja | Lightspeed auf iPads, Bondrucker und Bildschirme lokal im selben VLAN |
| 30 | Kameras | **nein** | Reolink ohne Cloud, nur über Hub und VPN |
| 40 | Betrieb (IoT) | ja | Shelly, Hue, Gardena |
| 41 | Anlage + Audio | – | Seilbahnsteuerung, Soundweb |
| 70 | Verwaltung | ja | Büro |
| 80 | Personal | ja | private Handys |

Die isolierten VLANs erreicht nur der Hub (siehe
[Entscheidungen](entscheidungen.md#hub-bleibt-im-management-vlan-03112026)).
Die SSID „TwinCable“ gehört zur Wasserski-Seilbahn, „Sound“ ist der PC, der
die Beschallung steuert.

## PR60X

- Firmware 2.x dokumentiert 8 VLANs mit DHCP-Server; geplant sind 7.
- Zwischen VLANs gibt es nur „Inter-VLAN-Routing“ an/aus pro VLAN plus
  Traffic-Regeln (Quelle/Ziel: Interface `Any` oder `vlanX`, dazu einzelne
  IP, Subnetz oder Bereich). Regeln sind zustandsbehaftet.
- SNMP v1/v2c/v3 seit FW 2.6; der SNMP-Client lässt sich auf eine IP
  beschränken. Kein Remote-Syslog, Logs bleiben in Insight.
- Die Fehlersuche-Ping-Funktion des Routers geht über WAN und kann keine
  VLAN-Hosts testen.
- Bekannte Firmware-Eigenheiten: IPsec zeigt auf WAN2 „UP“, obwohl WAN1
  trägt; WireGuard-Clients mit Full-Tunnel erreichen ihr eigenes LAN nicht
  („Block untunneled traffic“ aus lassen).

## Insight-Fallstricke

- **VLANs** am Router immer über die Geräteseite des PR60X bearbeiten
  (Einstellungen → VLAN/DHCP-Server → Zeile → Bearbeiten), nicht über den
  Standort-Assistenten.
- **DHCP-Reservierungen:** „IP reservieren“ in der Oberfläche reserviert nur
  die aktuelle IP. Eine andere IP geht nur über die Web-API des Routers.
  Namen nur aus Buchstaben, Ziffern und Bindestrichen (kein Unterstrich).
- **GC110P und GC728XP** holen DHCP mit der Insight-Geräte-MAC **+3**;
  Reservierungen müssen auf diese MAC lauten. Bei der ARP-Zuordnung
  behandelt der Cloud-Ingest gleiche erste fünf Oktette als ein Gerät.
- **GC108P-Bug (FW 1.0.8.10):** Eine Port-Änderung auf „untagged VLAN 30 +
  PVID 30“ kommt nur halb an. Die untagged-Mitgliedschaft wird nur gesetzt,
  wenn der Port in dem Moment in keinem anderen VLAN untagged ist, und die
  PVID nur, wenn er schon Mitglied ist. Folge war eine 22 Stunden dunkle
  Kamera. Abhilfe: einen weiteren VLAN-30-Push erzwingen (z. B. T30 an einem
  freien Port an- und abwählen) und den Kamera-Port erneut speichern.
  Nach jedem VLAN-Push prüfen: Wahrheit ist SNMP Q-BRIDGE vom Hub
  (`dot1qPvid`, Egress/Untagged, `dot1qTpFdbPort`), die Insight-Überwachung
  für GC108P ist unzuverlässig.
- **SNMP** fehlt bei den GC110P (EOL). Die Geräte dahinter sieht der Hub nur
  in der MAC-Tabelle des Core-Switches.
- **MAC-ACL einer SSID:** Beim Einschalten ist die Richtlinie „Zulassen“
  vorgewählt; das sperrt sofort **alle** anderen Geräte aus. Zum Sperren
  einzelner Geräte immer „Verbieten“ wählen.
- **PoE-Neustart** eines Ports: Gerät → Vorgänge → PoE-Management.
- Nach dem Router-Tausch bekamen Shellys neue DHCP-Adressen; per
  Reservierung zurückgeholt, sie wechseln bei der nächsten Lease-Erneuerung.
- WLAN-Kanalbreite: 2,4 GHz 20 MHz, 5 GHz 40 MHz; Band-Steering und
  802.11r nur auf Kassen- und Verwaltungs-SSID, nicht auf IoT-SSIDs.

## Hub und Netzwerk

- Hub-Scan sieht MACs nur in direkt angeschlossenen Netzen. In gerouteten
  VLANs lädt er erreichbare Hosts ohne MAC hoch; die Cloud markiert bekannte
  Einträge dann per IP als online. Shellys liefern ihre MAC über `/shelly`.
- Nach einem Kamera-Umzug (neue IP oder VLAN) einen Netzwerk-Scan auslösen,
  der Hub findet sie über die MAC wieder.
- Ausfallmeldungen: Cloud-Cron meldet Kamera/DoorBird/Soundweb nach
  10 Minuten unerreichbar (nur solange der Hub online ist); der Hub prüft
  alle 5 Minuten lesend per SNMP die VLAN-Belegung (`HUB_VLAN_CHECK_INTERVAL`).
- Reolink-OUI: `EC-71-DB`; BSS Soundweb: `00-0F-D4`; Philips Hue: `00-17-88`.
