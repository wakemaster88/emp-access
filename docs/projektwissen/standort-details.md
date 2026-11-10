# Standort-Details Tuttenbrocksee

Vollständiger Netz- und Gerätestand mit Adressen. Auf Aarons Wunsch
(10.11.2026) öffentlich im Repo. Stand: 8. November 2026, gelesen aus
NETGEAR Insight, dem Router und der Cloud-Datenbank. Bei Abweichungen gilt
Insight bzw. der Hub-Scan; diese Datei dann nachziehen.

Nicht hier: Passwörter, Tokens, SNMP-Community, WLAN-Schlüssel,
Insight-API-Schlüssel und Konto-IDs, die DynDNS-Adresse des VPN-Zugangs und
Daten Dritter (private Geräte von Personen).

## WAN

- Telekom VDSL ~250/40 Mbit/s (FTTC) über FRITZ!Box 7590 (Modem +
  Telefonie, 6 Rufnummern auf FON1/FON2). FRITZ!Box-Netz 192.168.0.0/24.
- PR60X WAN1 = 192.168.0.203 (doppeltes NAT). Portweiterleitung auf der
  FRITZ!Box „WireGuard PR60X“ UDP 51820 → 192.168.0.203, nur IPv4.
- Öffentliches Gäste-Netz: extern betreut, hängt direkt an der FRITZ!Box
  (D4:01:C3:5C:FC:B9), nicht am PR60X.
- AGFEO ist abgebaut; eine AGFEO-MAC 00:09:40:67:14:59 taucht noch unter
  192.168.1.150 auf.
- Vorschlag (offen): VDSL-Supervectoring-Modem (z. B. DrayTek Vigor 167) →
  PR60X WAN1 PPPoE mit VLAN 7, FRITZ!Box dahinter nur noch für Telefonie;
  dann braucht das Gäste-Netz ein eigenes isoliertes VLAN (z. B. 90).

## Router PR60X

- MAC C8:10:2F:32:93:A5, Management 192.168.1.1, FW 3.0.0.105.
- Uplink zum Core: LAN1 (U1, T20/30/40/41/70/80). LAN4 (SFP+) als Trunk
  vorbereitet, noch kein DAC-Kabel. LAN2: Synology-Backup (192.168.1.251).
- DHCP je VLAN .100–.250 (VLAN 1: .100–.150), Lease 1 Tag, DNS-Proxy.
- WireGuard: UDP 51820, Netz 10.10.0.0/24, Split-Tunnel auf VLAN
  1/30/40/41/70. Clients Aaron-iPhone 10.10.0.2, Aaron-MacBook 10.10.0.3.
  Konfiguration in Insight unter WireGuard Clients → Zeile → Mehr →
  QR-Code/Exportieren.
- SNMP v2c an, Client auf 192.168.1.121 beschränkt (antwortet dem Hub
  bisher nicht; die API meldet `snmpServer enabled:0`, mögliche Ursache).
- mDNS-Gateway an (je VLAN `isMdnsEnabled` noch aus).
- Backups in Insight: PR60X-final, PR60X-WireGuard, PR60X-Audit-2026-11-03.

### VLANs

| VLAN | Name | Netz | Inter-VLAN-Routing |
| --- | --- | --- | --- |
| 1 | Management + Hub | 192.168.1.0/24 | an |
| 20 | Kassensystem | 192.168.20.0/24 | an, per Regel nur Hub |
| 30 | Kameras | 192.168.30.0/24 | an, per Regel nur Hub |
| 40 | Betrieb (IoT) | 192.168.40.0/24 | an, per Regel nur Hub |
| 41 | Anlage + Audio | 192.168.41.0/24 | an, per Regel nur Hub |
| 70 | Verwaltung | 192.168.70.0/24 | an |
| 80 | Personal | 192.168.80.0/24 | an, per Regel nur Hub |

### Traffic-Regeln (IDs 0–22, seit 03./04.11.2026)

- VLAN 30: deny vlan30 → WAN, vlan30 → vlan1, vlan30 → vlan70.
- Für jedes X in 20, 40, 41, 80: allow vlan1 192.168.1.121 → X,
  deny Any → X, deny X → vlan1/vlan30/vlan70 (zustandsbehaftet).
- WireGuard-Clients erreichen 40/41 seitdem nicht mehr direkt.
- Offen: deny vlan70 → vlan1 (Verwaltung hat vollen Zugriff auf
  Management).

### DHCP-Reservierungen (Auszug)

| IP | Gerät | MAC |
| --- | --- | --- |
| 192.168.1.101 | Switch_Technikraum (Core) | 8C:3B:AD:66:C2:88 |
| 192.168.1.106 | Switch_Rooftop | +3-MAC |
| 192.168.1.121 | Hub-Technikraum (Mac Studio) | BC:89:C1:E4:3F:92 |
| 192.168.1.131 | DoorBird | 1C:CA:E3:75:86:E0 |
| 192.168.1.102 | Shelly Pro4PM Technikraum (Musik/Movingheads) | – |
| 192.168.1.136 | Shelly Rolltor Verleih | – |
| 192.168.30.16 | Kamera Übungslift | EC:71:DB:85:11:B3 |
| 192.168.30.18 | Kamera Seilbahn B Schanze | EC:71:DB:4E:A5:06 |
| 192.168.30.22 | Kamera Gastro (E1 Pro, WLAN) | 44:37:0B:FC:6A:3A |
| 192.168.40.111–.117, .179, .190 | Shellys (alte IPs nach Router-Tausch) | – |

VLAN 1: dazu 24 Reservierungen für Switches (.10–.19) und APs (.40–.53),
die meisten Switches nutzen aber noch andere Adressen (siehe unten).
Reservierungen anlegen geht beliebig nur per API:
`POST pr/v3/ipReserveDevice/{…}/ipResrvRule/{…}` mit
`[{deviceName, ip, mac, vlanId, port: "LAN1"}]`; löschen
`DELETE pr/v2/deleteIpReservation` mit demselben Body; Liste in Insight
unter Connected Clients → Statisch. Port-VLANs per
`PUT device/v1/vlanMembers/{deviceId}/{org}` mit
`{vlanPortMembers: {portIds, vlanMembers: [{vlanId, tagged}], defaultVlanId}}`
(vollständige Mitgliederliste je Port). Port-VLANs prüfen über
`monitoring/v1/{serial}/connectedNeighborsList/{org}` (`portVlanId`).

## Switches

SNMP-fähig (stehen in `HUB_SNMP_TARGETS`):

| Name | Modell | Seriennummer | IP |
| --- | --- | --- | --- |
| Switch_Technikraum (Core) | GC752XP | 51518A7P8008D | 192.168.1.101 |
| SwitchInsel | GC728XP | 5134917H800EB | 192.168.1.4 (statisch am Gerät) |
| SwitchContainer | GC108P | 5V480B7A00334 | 192.168.1.20 (statisch) |
| Bewaesserung | GC108P | 5V480B7S0027E | 192.168.1.25 (statisch) |
| SwitchHalle | GC108P | 5V460579801D9 | 192.168.1.18 |

Ohne SNMP (GC110P, EOL):

| Name | Seriennummer | IP |
| --- | --- | --- |
| Switch_Rooftop | 4WS17A7B8047F | 192.168.1.106 |
| Switch_Drehkreuze1 | 4WS17A7S80427 | 192.168.1.138 (dynamisch, zusätzlich 192.168.20.112) |
| Switch_Grillstation | 4WS17A7W80455 | 192.168.1.22 |
| SwitchRestaurant | 4WS17A7D802E9 | 192.168.1.21 |
| SwitchBuchhaltung | 4WS17A7X80383 | 192.168.1.132 (zusätzlich 192.168.40.130) |

### Core-Switch (GC752XP) Ports

- P1 → PR60X LAN1: U1 + T20/30/40/41/70/80.
- Trunks zu APs/Switches (4, 8, 15, 23, 27, 35, 38, 39, 42, 43, 47, 49):
  U1 + T20/30/40/41/70/80 (seit 04.11.2026).
- P7 = U70 + T40, PVID 70; P17 = U20 + T40, PVID 20 (Epson).
- P13/P14: vermutlich Soundweb (OUI 00:0F:D4); P13 PVID 40 aber nur U1, stumm.
- P22: Synology-Cluster (192.168.1.254). P41: Kamera 30.11.
- P42 → Grillstation (versorgt Bewaesserung): U1 + T30/40/41/80.
- P46: Mac Studio (Hub). P5: alter iMac (C0:B2:2F:8C:6D:0C).
- Rooftop-Uplink von P22 auf P47 umgezogen, P30 auf P45.
- CRC-Fehler: P8 (AP-Menzel, Kabel), P17, P38.
- Hub ↔ Kamera-Streams laufen über P1 durch den Router (~100–130 Mbit/s).

### SwitchInsel (GC728XP)

Uplink P25; P1 AP-Insel-Kiosk (Link nur 10 Mbit), P19 AP_Insel; P2 U40
PVID 40; P8, P9, P20 VLAN-1-Strecken ohne Kamera (vermutlich Funkbrücke).
P13 (U30/PVID30 seit 04.11.2026): unmanaged NETGEAR GS110TPv3
(54:07:7D:28:D3:71, Netzteil, kein PoE) mit den Kameras Übungslift,
Seilbahn B und einer dritten Reolink EC:71:DB:CD:BF:4F (vermutlich statisch
192.168.1.101 = „Seilbahn B Schanze 2“). Die Kameras bekommen VLAN-30-DHCP
erst nach einem Stromzyklus des GS110TP.

## Access Points

14 APs: 7× WAC505, 5× WAC540 (FW 9.9.6.8, EOL), 1× WAX615 (AP-Shop),
1× WAX610Y (AP-Eingang). Geplante Adressen .40–.53. APImbisscontain hat
statisch 192.168.1.30. 2,4 GHz Sendeleistung halbiert auf APImbiss,
APImbisscontain, APGrillstation. APRestaurant, AP-Shop, AP-Eingang waren im
Sommer offline.

## WLAN (SSIDs)

| SSID | VLAN | Hinweis |
| --- | --- | --- |
| TwinCable | 1 | Seilbahnsteuerung: 5 D-Link B0-C5-54 (.62–.67), LOQED, Shelly Pro; MAC-ACL „Verbieten“ aktiv |
| Tuttenbrocksee - Management | 1 | soll entfallen |
| Tuttenbrocksee - Kassensystem | 20 | Band-Steering + 802.11r |
| Kassensystem2 | 20 | keine Clients, soll deaktiviert werden |
| Tuttenbrocksee - Kameras | 30 | 2,4 GHz, WPA2, für WLAN-Kameras |
| Tuttenbrocksee - Betrieb | 40 | Shellys, nur 2,4 GHz |
| Sound | 40 | nur Sound-PC 0C:54:15:CE:DF:BA (statisch 192.168.178.100, über AP_Insel) |
| Tuttenbrocksee - Verwaltung | 70 | Band-Steering + 802.11r |

## Kameras (Reolink, VLAN 30, statisch am Gerät)

| Cloud-ID | Name | Modell | IP | MAC (Ende) | Anschluss |
| --- | --- | --- | --- | --- | --- |
| – | Kamera Core | – | 192.168.30.11 | B7:0E:00 | Core P41 |
| 3 | Halle | RLC-823S1 | 192.168.30.12 | BE:ED:27 | SwitchHalle P3 |
| – | Drehkreuze | – | 192.168.30.13 / .14 / .15 | 29:EA:4E / 34:C5:38 / C2:BC:FF | Drehkreuze1 P2/3/8 |
| 5 | Übungslift | RLC-823A 16X | 192.168.30.16 | 85:11:B3 | Insel P13 (GS110TP) |
| 6 | Seilbahn A | – | 192.168.30.17 (geplant) | F8:24:E1 | offline |
| 4 | Seilbahn B Schanze | – | 192.168.30.18 | 4E:A5:06 | Insel P13 (GS110TP) |
| 1 | Aquapark | Duo 3 | 192.168.30.19 | F5:46:DD | Bewaesserung P3 |
| – | Imbisscontainer | – | 192.168.30.20 | F7:EB:A1 | Container P7 |
| 9 | Eingang / Kennzeichen-Tor | RLC-811A | 192.168.30.21 | F4:28:66 | Container P6 |
| 2 | Gastro | E1 Pro | 192.168.30.22 | FC:6A:3A | WLAN Kameras |
| 13 | Halle 2 | RLC-811A | 192.168.30.23 | 56:93:E4 | Grillstation P3 |
| 7 | Shop | E1 Pro | – | – | – |
| 10 | Drehkreuz | RLC-811A | vermutlich 192.168.30.14 | – | Drehkreuze1 |

Reolink-OUI EC:71:DB. Cloud-Kamera 11 = „DoorBird Eingang“. Toter
go2rtc-Stream `cam-drehkreuze` (192.168.1.75) ist deaktiviert; seine
Personenzähler-/Tailgate-Konfiguration müsste auf `cam-eingang` (= Drehkreuz,
30.14) umziehen. 192.168.1.69 im alten Stream-Bestand = Seilbahn A
(offline).

## Weitere Geräte

- **DoorBird** 192.168.1.131 (MAC 1C:CA:E3:75:86:E0, SwitchHalle P2).
- **Soundweb London (BSS)** Blu-100: 192.168.1.50 und .150, seit
  mindestens 16.09. nicht erreichbar; .50 ist zusätzlich für
  AP-Insel-Kiosk reserviert (Konflikt). Geplant: 192.168.41.10.
- **Sound-PC** statisch 192.168.178.100 (Fritzbox-Altnetz), geplant 41.12.
- **Synology** HA-Cluster: SYNOLOGYCLUSTER 192.168.1.254 (Core P22),
  Synology-Backup 192.168.1.251 (PR60X LAN2), direkte Heartbeat-Leitung.
- **Philips Hue**: 4 Bridges in VLAN 1/20/70, noch nicht mit dem Hub
  gekoppelt.
- **Shellys** in VLAN 40; Tor Aquapark (Device 1.101) und Tür VIP Lounge
  (1.100) haben keine `shellyId`.
- **Mammotion**: Luba 3 AWD (Luba-VA6C39PZ, Cloud-Device 115), Luba 2 AWD
  (Luba-VSG3QASL, Cloud-Device 116), beide Raum 11 Strandbad. Brauchen
  Internet, daher nicht in VLAN 30.
- Drehkreuz mit Scans: nur „Seilbahn A - Drehkreuz“ (Device 84), Spitze
  ~100 Eintritte/h.

## Hub (Mac Studio)

- Rechnername Hub-Technikraum, Benutzer `aaronarmborst`, macOS 27.2 arm64,
  Apple M5 Max 18 Kerne, 64 GB.
- Ethernet en0 BC:89:C1:E4:3F:92, 192.168.1.121 (manuell per
  `networksetup -setmanualwithdhcprouter` plus Reservierung), Core P46.
  WLAN en1 bc:89:c1:da:2c:de (aus).
- `HUB_NAME` weiter `imac-technikraum`. Alter Cloud-HubAgent
  „imac-von-aaron“ (id 450795) ist verwaist.
- Dashboard https://192.168.1.121:8787, go2rtc WebRTC 192.168.1.121:8555,
  Webcams :3000, Tracker :8088. Ein zweiter WebRTC-Kandidat 192.168.1.202
  wurde entfernt (Backup `go2rtc.yaml.bak-20261108-b`).
- Software: go2rtc 1.9.15 in `webcams/bin`, Face/ALPR/Tracker Python 3.12,
  Mäher Python 3.13, Ollama mit `qwen3:30b-a3b-instruct` und `qwen3-vl:8b`,
  whisper.cpp `large-v3-turbo`.
- Alter iMac: Benutzer `aaronarmnborst`, MAC C0:B2:2F:8C:6D:0C,
  LaunchAgents in `~/LaunchAgents-alt`.

## Cloud

- Vercel-Projekt emp-access, Datenbank Neon „emp-access“.
- emp-control: eigenes Repo `EMP-Control-UG/emp-control`, Vercel-Projekt
  emp-control, eigene Neon-Datenbank; Mandant `tuttenbrocksee`
  (https://tuttenbrocksee.emp-control.com). Monitor-Link in ApiConfig
  EMP_CONTROL `extraConfig.monitorUrl`.
- Account 1 hat keine Koordinaten; Hub nutzt 51.756 / 8.043.
- NetworkVlan-IDs: 30 = 5, 41 = 6, 80 = 7. Router = NetworkDevice 15.
- Räume: 1 Shop, 3 Imbiss, 5 Umkleide Damen, 6 Umkleide Herren,
  10 Personalraum, 11 Strandbad, 20 Büro, 21 Büro Aaron, 22 Insel,
  23 Aquapark. Zeitpläne: 3 Strandbad, 4 Gastronomie, 5 „Wasserski & Shop“,
  6 Aquapark (zu bis 30.04.2027).
- Umkleide Damen: Heizung Device 9, Lüfter 25/18 (an ≥ 65 %, aus < 58 %,
  45 min Nachlauf, Frostsperre < 8 °C), Fühler 11. Umkleide Herren:
  Heizung 8, Fühler 10, Licht 42/45/48/46. Beide 21,5 °C, Vorheizen 60 min,
  Frostschutz 5 °C.
- Netzwerk-Inventar: Raumkarte „Netzwerk x von y online“ =
  `lastSeenAt` < 30 min, gesetzt nur durch Hub-Scan
  (`/api/hub/scan`) und SNMP-Ingest. NetworkClient 39 und 65 haben beide
  192.168.20.90 mit derselben MAC (Bondrucker Imbiss 2 vs. Shop).
