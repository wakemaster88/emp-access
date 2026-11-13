# Projektwissen

Was über den Code hinaus zum Projekt gehört: Arbeitsregeln, Entscheidungen
und warum sie so gefallen sind, Betrieb des Hubs, bekannte Fallstricke und
offene Punkte. Stand: 8. November 2026.

| Datei | Inhalt |
| --- | --- |
| [entscheidungen.md](entscheidungen.md) | Grundsatzentscheidungen mit Begründung |
| [netzwerk.md](netzwerk.md) | VLAN-Rollen, Router/Switch-Eigenheiten, Insight-Fallstricke |
| [hub-betrieb.md](hub-betrieb.md) | Hub-Maschine (Mac Studio), Dienste, Logs, Streams, Kameras |
| [funktionen.md](funktionen.md) | Funktionen, die sonst nirgends beschrieben sind |
| [offene-punkte.md](offene-punkte.md) | Was noch aussteht oder auf eine Entscheidung wartet |
| [sicherheit.md](sicherheit.md) | Täglicher Sicherheitscheck, Behebung, Sicherheitsregeln im Code |
| [standort-details.md](standort-details.md) | Netzplan mit Adressen, Router-Regeln, Switches, Kameras, Hub, Cloud-IDs |

Weitere Dokumente im Repo: [`README.md`](../../README.md) (Cloud),
[`hub/README.md`](../../hub/README.md) (Hub-Funktionen und Installation),
[`hub/IMPROVE.md`](../../hub/IMPROVE.md) (Verbesserungslog),
[`docs/design-regeln.md`](../design-regeln.md) (einziges Design-Regelwerk).

## Was nicht im Repo steht

Das Repo ist öffentlich. Auf Aarons Entscheidung (10.11.2026) steht der
Standort trotzdem vollständig hier, mit Adressen und Regeln. Draußen
bleiben nur Passwörter, Tokens, SNMP-Community, WLAN-Schlüssel,
Insight-API-Schlüssel und Konto-IDs, die DynDNS-Adresse des VPN-Zugangs und
Daten Dritter. Geheimnisse liegen nur in `hub/.env` auf der Hub-Maschine
bzw. in den Vercel-Umgebungsvariablen. Hintergrund und Entstehung des
Netzplans stehen in den Claude-Dokumenten „Netzwerkplan Tuttenbrocksee –
PR60X“ und „Mac Studio als neuen Hub einrichten“.

## Arbeitsregeln

- Kommunikation mit Aaron auf Deutsch.
- Pull Requests werden gemergt, sobald CI grün ist, ohne auf ein „merge“
  zu warten (seit 03.11.2026). Der Hub zieht `main` nach etwa 5 Minuten
  selbst nach.
- Änderungen am Netzwerk (Router, Switches, WLAN, DHCP-Reservierungen,
  Firewall-Regeln) und an Kamera-Einstellungen nur mit Aarons
  ausdrücklichem OK, auch wenn der Code dafür schon bereit ist.
- Claude meldet sich nie selbst an Geräten an (Kameras, Switches) und
  speichert keine Gerätepasswörter.
- Nach jedem Merge den Arbeits-Branch neu von `main` starten.
