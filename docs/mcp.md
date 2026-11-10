# MCP-Schnittstelle (KI-Assistenten)

EMP-Access spricht das [Model Context Protocol](https://modelcontextprotocol.io). Damit können
Claude und andere KI-Assistenten die Anlage abfragen und – je nach Token-Stufe – Geräte schalten.

## Aufbau

- Endpunkt: `POST /api/mcp` der Cloud-App (Streamable HTTP, zustandslos, Antworten als JSON,
  kein SSE). Code: `src/app/api/mcp/route.ts`, `src/lib/mcp/`.
- Cloud-Werkzeuge lesen direkt aus der Datenbank bzw. schalten Geräte über denselben Weg wie die
  Oberfläche (`triggerDeviceAction`, Raumregeln laufen mit).
- Hub-Werkzeuge sind die Werkzeuge des Hub-Assistenten (`hub/src/agent/tools.ts`). Die Cloud legt
  einen Hub-Task `AGENT_TOOL` an und wartet bis zu 25 s. Der Hub führt nur Werkzeuge aus seiner
  eigenen Freigabeliste aus (`hub/src/agent/mcp-bridge-rules.ts`) und verwirft Anfragen nach ihrer
  Ablaufzeit, damit z. B. ein Tor nicht Minuten später doch noch aufgeht.

## Anmeldung

Tokens legt ein Admin unter **Einstellungen → MCP-Schnittstelle** an. Gespeichert wird nur der
SHA-256; der Klartext erscheint einmal beim Anlegen. Übergabe als `Authorization: Bearer mcp_…`
oder – für Clients ohne eigene Kopfzeilen, etwa Connectoren in der Claude App – als `?token=mcp_…`
in der URL. Widerrufen wirkt sofort.

## Stufen

| Stufe | Darf |
|---|---|
| `read` | Alles lesen, nichts schalten |
| `operate` | Zusätzlich Licht, Markisen, Steckdosen, Audio, Bewässerung, Mäher, Kameralicht/-position |
| `access` | Zusätzlich Türen, Tore, Schlösser, Drehkreuze, Taster, Sirene (derzeit nicht freigeschaltet, siehe `MCP_OFFERED_LEVELS`) |

Welche Stufe ein Gerät braucht, bestimmt `src/lib/mcp/device-level.ts`: Zutritt, Taster und Geräte
ohne Kategorie brauchen `access`, ebenso Namen mit Tor/Tür/Schranke/Schloss. Netzwerkänderungen
(Router, Switches, VLANs, WLAN, Firewall) gibt es auf keiner Stufe. Jeder schaltende Aufruf wird
in Telegram gemeldet.

## Werkzeuge

Cloud: `search_tickets`, `recent_scans`, `list_devices`, `hub_alerts`, `verein_bookings`,
`vehicle_sightings`, `lost_items`, `camera_snapshot` (Bild), `switch_device`.

Hub: `hub_status`, `who_is_working`, `occupancy`, `day_preview`, `list_cameras`, `list_events`,
`list_rooms`, `climate`, `network_overview`, `early_warnings`, `weather_forecast`, `energy_plan`,
`mower_status`, `read_log`, `mower_action`, `camera_control`, `open_gate`.

Ein neues Hub-Werkzeug braucht einen Eintrag in `src/lib/mcp/tools.ts` **und** in
`MCP_BRIDGE_TOOLS`; der Test `src/lib/mcp/tools.test.ts` prüft, dass beide Listen übereinstimmen.

## Einrichten

- Claude Code:
  `claude mcp add --transport http emp-access https://<domain>/api/mcp --header "Authorization: Bearer mcp_…"`
- Claude App (Web, Desktop, Handy): Einstellungen → Connectors → eigenen Connector hinzufügen,
  URL `https://<domain>/api/mcp?token=mcp_…`.

Die fertigen Befehle zeigt die Einstellungsseite direkt nach dem Anlegen eines Tokens.
