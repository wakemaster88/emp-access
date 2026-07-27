# EMP Access – Raspberry Pi Audio Player

Zonen-Abspieler für Musik und Durchsagen. Jeder Pi bedient genau eine
Beschallungszone aus dem Dashboard (`/audio`) und meldet seinen Zustand dorthin
zurück.

## Funktionen

- Hintergrundmusik aus einer Dashboard-Playlist oder einem Webradio-Stream
- Durchsagen mit Gong, Wiederholung und automatischem Absenken der Musik (Ducking)
- Notfalldurchsagen (Priorität ≥ 100) unterbrechen eine laufende Ansage
- Lokaler Dateicache – einmal geladene Titel laufen auch ohne Internet weiter
- Ruhezeiten je Zone: Musik startet nicht, Durchsagen immer
- Synchrone Wiedergabe überlappender Außenbereiche über Snapcast
- Auto-Update per git und systemd-Watchdog wie beim Scanner

## Hardware

- Raspberry Pi 3 oder neuer (Pi Zero 2 W reicht für eine Zone)
- USB-Soundkarte oder HiFiBerry-HAT – der Klinkenausgang des Pi rauscht hörbar
- Verstärker bzw. Aktivlautsprecher pro Zone

Der Onboard-Ausgang funktioniert für erste Tests, für den Dauerbetrieb ist eine
USB-Soundkarte die deutlich bessere Wahl.

## Installation

```bash
# Auf dem Raspberry Pi:
git clone https://github.com/wakemaster88/emp-access.git
cd emp-access/raspberry-pi
sudo bash install-audio.sh
```

Das Skript installiert `mpv`, legt ein venv unter `/opt/emp-audio` an, fragt die
Zugangsdaten ab und richtet die Dienste `emp-audio` sowie den Update-Timer ein.
Scanner und Abspieler können parallel auf demselben Pi laufen – sie nutzen
getrennte Installationsverzeichnisse und Konfigurationsdateien.

## Ersteinrichtung

1. Im Dashboard unter **Geräte** ein Gerät vom Typ `AUDIO_PLAYER` anlegen.
2. Unter **Audio → Zonen** eine Zone anlegen und dieses Gerät zuweisen.
3. Das Konfigurations-JSON aus den Gerätedetails (derselbe Inhalt wie beim
   Scanner-QR-Code) beim Installieren einfügen – oder später nachtragen:

```bash
cd /opt/emp-audio/raspberry-pi
sudo /opt/emp-audio/venv/bin/python -m emp_audio.setup '{"url":"https://...","token":"...","id":42}'
sudo systemctl restart emp-audio
```

## Konfiguration

`/opt/emp-audio/raspberry-pi/audio-config.json`:

| Feld | Standard | Bedeutung |
| --- | --- | --- |
| `server_url` | – | Basis-URL des Dashboards |
| `api_token` | – | Account-API-Token |
| `device_id` | – | Geräte-ID aus dem Dashboard |
| `job_poll_interval` | `5` | Sekunden bis eine Durchsage startet (min. 3) |
| `heartbeat_interval` | `60` | Zustandsmeldung an den Server |
| `update_check_interval` | `300` | Update-Prüfung |
| `audio_device` | `""` | mpv-Ausgabegerät, z. B. `alsa/hw:1,0` |
| `snapserver_host` | `""` | Snapserver für synchrone Zonen; leer = eigenständig |
| `snapclient_soundcard` | `""` | Soundkarte des Snapclients (aus `snapclient -l`) |
| `cache_max_mb` | `2048` | Obergrenze des lokalen Dateicaches |

Lautstärke, Ansagelautstärke, Ducking-Pegel und Ruhezeiten kommen aus der Zone
im Dashboard und müssen hier nicht gepflegt werden.

### Ausgabegerät finden

```bash
aplay -l                      # verfügbare Karten auflisten
speaker-test -c2 -twav        # Standardausgang testen
mpv --audio-device=help       # exakte Gerätenamen für audio_device
```

### API-Häufigkeit

Der Job-Poll bestimmt, wie schnell eine Durchsage losgeht. 5 Sekunden sind ein
guter Kompromiss; darunter steigen die Function-Invocations spürbar, ohne dass
es sich im Betrieb merklich flüssiger anfühlt. Wer echte Sofort-Durchsagen
braucht, sollte den Poll durch eine SSE-Verbindung ersetzen statt das Intervall
zu drücken.

## Synchrone Zonen (Snapcast)

Nur nötig, wenn zwei Zonen sich akustisch überlappen – etwa zwei Außenbereiche
nebeneinander. Ohne Synchronisierung entsteht dort ein hörbarer Versatz.

In diesem Modus liefert der Snapserver die Musik, die Pis sind reine Clients.
Durchsagen laufen weiterhin lokal über mpv; fürs Ducking senkt der Client seine
Snapcast-Lautstärke über die Steuerschnittstelle des Servers ab.

Der Snapserver läuft sinnvollerweise auf dem Mac-Hub oder einem festen Pi:

```bash
sudo apt install snapserver
# /etc/snapserver.conf: eine Stream-Quelle definieren, z. B. einen mpv-FIFO
```

Auf den Zonen-Pis genügt dann die Angabe von `snapserver_host`. Soll der Client
auf eine bestimmte Soundkarte ausgeben, gehört deren Name aus `snapclient -l` in
`snapclient_soundcard` – `audio_device` gilt nur für mpv und hat eine andere
Schreibweise.

## Betrieb

```bash
# Status prüfen
systemctl status emp-audio

# Live-Logs anzeigen
journalctl -u emp-audio -f

# Manuell neustarten
sudo systemctl restart emp-audio

# Cache ansehen / leeren
du -sh /var/lib/emp-audio/cache
sudo rm -rf /var/lib/emp-audio/cache/*
```

## Ablauf einer Durchsage

1. Dashboard erzeugt einen Job vom Typ `ANNOUNCE` für alle Zielzonen.
2. Der Pi holt ihn beim nächsten Poll ab und meldet `PLAYING`.
3. Musik wird auf den Ducking-Pegel abgesenkt, optional ertönt der Gong.
4. Die Ansage läuft – bei `repeat > 1` mehrfach mit kurzer Pause.
5. Musik wird wieder hochgefahren, der Pi meldet `DONE`.

Der Gong wird beim ersten Start als `/var/lib/emp-audio/chime.wav` erzeugt.
Wer einen eigenen möchte, überschreibt einfach diese Datei.

## Fehlerbehebung

### Keine Wiedergabe, Logs zeigen „mpv ist nicht installiert"

```bash
sudo apt install mpv
sudo systemctl restart emp-audio
```

### Durchsage stumm, während Musik läuft

Zwei mpv-Prozesse greifen gleichzeitig auf die Soundkarte zu. Das braucht einen
Mixer – auf Raspberry Pi OS Bookworm ist PipeWire vorinstalliert, auf älteren
Systemen fehlt er:

```bash
sudo apt install pipewire pipewire-alsa
sudo reboot
```

Alternativ in `/etc/asound.conf` ein `dmix`-Gerät einrichten und dieses als
`audio_device` eintragen.

### „Keine Zone für Gerät #x hinterlegt"

Dem Gerät ist im Dashboard keine Zone zugewiesen, oder der Gerätetyp ist nicht
`AUDIO_PLAYER`. Beides unter **Audio → Zonen** korrigieren.

### Zone bleibt im Dashboard offline

`journalctl -u emp-audio -f` prüfen. Häufigste Ursachen sind ein falsches
API-Token oder eine falsche `device_id` in `audio-config.json`.

## Entwicklung (ohne Pi)

```bash
cd raspberry-pi
python3 -m venv venv && source venv/bin/activate
pip install -r requirements-audio.txt
python -m emp_audio.setup '{"url":"http://localhost:3000","token":"...","id":1}'
python -m emp_audio.main
```

Auf macOS und Linux läuft der Client unverändert, solange `mpv` installiert ist
(`brew install mpv`). Systeminfos und Watchdog sind dort schlicht leer.
