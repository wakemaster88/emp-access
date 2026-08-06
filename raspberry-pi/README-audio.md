# EMP Access – Raspberry Pi Audio Player

Zonen-Abspieler für Musik und Durchsagen. Jeder Pi bedient genau eine
Beschallungszone aus dem Dashboard (`/audio`) und meldet seinen Zustand dorthin
zurück.

## Funktionen

- Hintergrundmusik aus einer Dashboard-Playlist oder einem Webradio-Stream
- Durchsagen mit Gong, Wiederholung und automatischem Absenken der Musik (Ducking)
- Notfalldurchsagen (Priorität ≥ 100) unterbrechen eine laufende Ansage
- Lokaler Dateicache – einmal geladene Titel laufen auch ohne Internet weiter
- Ruhezeiten je Zone: eigene Musik/Stream wird gestoppt und startet nicht, Durchsagen immer
- AirPlay- und Bluetooth-Empfang: ein Handy übernimmt die Zone auf Zuruf
- Synchrone Wiedergabe überlappender Außenbereiche über Snapcast
- Auto-Update per git und systemd-Watchdog wie beim Scanner

## Hardware

- Raspberry Pi 3 oder neuer (Pi Zero 2 W reicht für eine Zone)
- USB-Soundkarte oder HiFiBerry-HAT – der Klinkenausgang des Pi rauscht hörbar
- Verstärker bzw. Aktivlautsprecher pro Zone

Der Onboard-Ausgang funktioniert für erste Tests, für den Dauerbetrieb ist eine
USB-Soundkarte die deutlich bessere Wahl.

## Raspberry Pi vorbereiten

Nur bei einem frisch ausgepackten Pi nötig. Läuft schon ein Raspberry Pi OS mit
SSH-Zugang, geht es direkt beim nächsten Abschnitt weiter.

1. **System schreiben:** Mit dem [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
   **Raspberry Pi OS Lite (64-bit)** auf die SD-Karte schreiben – aktuell Debian 13
   („Trixie“). Einen Desktop braucht der Abspieler nicht.
2. **Headless einrichten:** Im Imager unter *Einstellungen bearbeiten* Hostname
   (z. B. `audio-liegewiese`), Benutzer, WLAN und **SSH aktivieren** hinterlegen.
   Ohne das braucht der erste Start Tastatur und Bildschirm. Eine
   DHCP-Reservierung im Router erspart später das Suchen der IP-Adresse.
3. **Erster Start:** Karte einlegen, booten, einloggen und aktualisieren:

   ```bash
   ssh benutzer@audio-liegewiese.local
   sudo apt update && sudo apt full-upgrade -y
   ```

4. **Ton vorbereiten:** Eine USB-Soundkarte anstecken, wenn die Klinke des Pi
   nicht genügt (oder gar keine da ist – der Pi 5 hat keine mehr). Um das
   Mischen kümmert sich das Installationsskript, dazu ist vorher nichts nötig:

   ```bash
   aplay -l                    # Karte muss als eigene Karte erscheinen
   speaker-test -c2 -twav -l1  # kommt Ton? Dann weiter mit der Installation
   ```

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

Beim Audioausgang fragt es, welche Soundkarte die Zone bespielen soll, und legt
dafür ein Mischgerät in `/etc/asound.conf` an (siehe unten). Läuft auf dem Pi
ein Desktop, bietet es außerdem an, PipeWire in dessen Sitzung abzuschalten.

Außerdem fragt es nach AirPlay- und Bluetooth-Empfang. Beides ist optional und
lässt sich jederzeit durch erneutes Ausführen nachrüsten – siehe
[Senden vom Handy](#senden-vom-handy-airplay-und-bluetooth).

## Ersteinrichtung

1. Im Dashboard unter **Geräte → Gerät hinzufügen** die Hardware
   **Audio-Player** wählen (Gerätetyp `AUDIO_PLAYER`, Funktion `AUDIO`).
2. Unter **Audio → Zonen** eine Zone anlegen und dieses Gerät zuweisen.
3. In den Gerätedetails steht unter **Abspieler einrichten** das
   Konfigurations-JSON zum Kopieren (derselbe Inhalt wie beim Scanner-QR-Code).
   Es beim Installieren einfügen – oder später nachtragen:

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
| `audio_device` | `""` | mpv-Ausgabegerät; leer bedeutet `alsa/default` |
| `snapserver_host` | `""` | Snapserver für synchrone Zonen; leer = eigenständig |
| `snapclient_soundcard` | `""` | Soundkarte des Snapclients (aus `snapclient -l`) |
| `cache_max_mb` | `2048` | Obergrenze des lokalen Dateicaches |
| `speech_normalize` | `true` | Hebt leise Durchsagen auf einen einheitlichen Pegel |
| `external_pcm` | `emp_external` | ALSA-Gerät für AirPlay und Bluetooth |
| `external_mixer` | `EmpExternal` | softvol-Regler, über den beide abgesenkt werden |
| `external_ctl` | `default` | Steuergerät, über das `amixer` den Regler erreicht |
| `external_poll_interval` | `2` | Sekunden, bis eine Übernahme auffällt |

Lautstärke, Ansagelautstärke, Ducking-Pegel und Ruhezeiten kommen aus der Zone
im Dashboard und müssen hier nicht gepflegt werden.

### Sprachanhebung

Musiktitel sind auf Vollpegel gemastert, eine Sprachdatei aus der
Text-zu-Sprache nicht – sie hat reichlich Luft nach oben. Ohne Ausgleich geht
die Ansage gegen die Musik unter, und mit dem Regler ist bei 100 Schluss. Der
Abspieler zieht die Ansage darum vor der Wiedergabe auf einen einheitlichen
Pegel hoch (ffmpeg-Filter `speechnorm`, ersatzweise `dynaudnorm` auf älteren
Systemen). Der Gong bleibt unangetastet: sein Pegel steht fest, und ein
ausklingender Ton würde von der Anhebung künstlich gehalten.

Kennt das ffmpeg des Systems keinen der Filter, läuft die Ansage unverändert
weiter – im Journal steht dann „mpv nimmt die Sprachanhebung nicht an".

### Ausgabegerät und Mischgerät

```bash
aplay -l                      # verfügbare Karten auflisten
speaker-test -c2 -twav -l1    # Standardausgang testen
mpv --audio-device=help       # exakte Gerätenamen für audio_device
```

Der Dienst läuft als `root` und erreicht PipeWire deshalb nicht – das läuft in
der Sitzung des angemeldeten Benutzers. Gemischt wird darum in ALSA selbst, und
das Installationsskript legt die passende Standardausgabe in `/etc/asound.conf`
an. Alles läuft dort auf `emp_out` zusammen; `pcm.!default` (Musik und
Durchsagen) und `pcm.emp_external` (AirPlay, Bluetooth) sind nur zwei Zugänge
dazu. Wie `emp_out` aussieht, hängt an der Karte:

* Die Klinke des Pi (`bcm2835 Headphones`) hat acht Subdevices und mischt im
  Treiber. Dort genügt `plug` auf die Karte; ein `dmix` davor scheitert sogar
  („unable to open slave").
* Eine USB-Karte nimmt meist nur einen Strom an. Davor kommt ein `dmix`, sonst
  bekäme die Durchsage die Karte nicht mehr auf, solange Musik läuft.

Wie viele Ströme eine Karte annimmt, sagt `aplay -l` in der Zeile `Subdevices`
oder `cat /proc/asound/<karte>/pcm0p/info`.

Der Abspieler gibt mpv immer ein Gerät vor (ohne Eintrag `alsa/default`). Ohne
Vorgabe würde mpv seine Treiberliste durchprobieren und am Ende bei Jack oder
sndio landen – beides gibt es auf einem Pi nicht, es kommt einfach kein Ton.

Eine andere Karte wählt man am einfachsten, indem man `install-audio.sh` erneut
ausführt; die bisherige `asound.conf` wird dabei als `.bak` gesichert.

### API-Häufigkeit

Der Job-Poll bestimmt, wie schnell eine Durchsage losgeht. 5 Sekunden sind ein
guter Kompromiss; darunter steigen die Function-Invocations spürbar, ohne dass
es sich im Betrieb merklich flüssiger anfühlt. Wer echte Sofort-Durchsagen
braucht, sollte den Poll durch eine SSE-Verbindung ersetzen statt das Intervall
zu drücken.

## Senden vom Handy (AirPlay und Bluetooth)

Eine Zone kann sich nebenbei als AirPlay- und Bluetooth-Lautsprecher anbieten.
Verbindet sich ein Sender, übernimmt er die Zone: die eingestellte Quelle wird
angehalten und läuft weiter, sobald die Verbindung endet. Umschalten muss man
nichts, auch nicht zurück.

Durchsagen behalten dabei immer Vorrang – auch gegen einen fremden Sender. Die
Ruhezeit gilt weiter nur für die eigene Musik: wer abends bewusst etwas
aufspielt, wird nicht ausgebremst.

_Kein Spotify Connect: Raspotify und librespot untersagen ausdrücklich
kommerzielle und öffentliche Wiedergabe. Über AirPlay oder Bluetooth lässt sich
Spotify vom Handy trotzdem abspielen._

### Einrichten

1. `sudo bash install-audio.sh` erneut ausführen und die Fragen nach AirPlay bzw.
   Bluetooth mit „j" beantworten. Das installiert `shairport-sync` bzw.
   `bluez-alsa-utils` und `bluez-tools` und baut `/etc/asound.conf` um.
2. Bis zum nächsten Heartbeat warten (max. 60 s). Der Abspieler meldet dabei,
   was er kann.
3. Im Dashboard unter **Audio → Zonen** die Zone bearbeiten und die Schalter
   setzen. Vorher sind sie gesperrt: eine Einstellung, die der Pi nicht umsetzt,
   wäre schlimmer als keine.

Optional lässt sich ein abweichender Name hinterlegen – so heißt die Zone am
Handy z. B. „Liegewiese" statt „Zone 3 Außen".

Die Reihenfolge ist kein Zufall: Der Updater zieht neuen Code binnen fünf
Minuten, `/etc/asound.conf` und die apt-Pakete fasst aber nur `install-audio.sh`
an. Ein Pi ohne diesen Lauf meldet einfach kein Backend und verhält sich wie
bisher – zonenweise nachrüsten ist damit gefahrlos, laufende Zonen bleiben
unberührt.

### Bluetooth koppeln

Auf der Zonenkarte gibt **Bluetooth-Kopplung freigeben** ein Fenster von fünf
Minuten frei. Nur darin ist die Zone am Handy sichtbar und nimmt neue Kopplungen
an – ohne PIN, dafür sorgt ein `bt-agent` im Hintergrund. Danach schließt sie
sich von selbst; bereits gekoppelte Geräte verbinden sich weiterhin jederzeit.

Ein dauerhaft sichtbarer Lautsprecher wäre für jeden in Funkreichweite ein
offenes Angebot. Wer ein gekoppeltes Gerät wieder loswerden will, muss das
derzeit auf dem Pi tun:

```bash
bluetoothctl devices Paired
bluetoothctl remove AA:BB:CC:DD:EE:FF
```

### Wie das Ducking funktioniert

Ein fremder Prozess hat keinen Steuersocket wie mpv – seine Lautstärke lässt
sich nur in ALSA greifen. Beide Empfänger geben darum auf `pcm.emp_external` aus,
das über einen `softvol`-Regler auf `emp_out` läuft. Eine Durchsage senkt ihn per
`amixer` auf den Ducking-Pegel der Zone und dreht ihn danach wieder auf.

```bash
amixer sget EmpExternal                 # aktueller Pegel
amixer sset EmpExternal 100%            # von Hand aufdrehen
aplay -D emp_external -d 1 /dev/zero    # Regler anlegen, falls amixer ihn nicht findet
```

Den Regler gibt es erst, nachdem `emp_external` einmal geöffnet wurde – vorher
kennt ihn `amixer` nicht. Der Installer und der Abspieler erzeugen ihn beim Start
darum mit einem Bruchteil Stille. Der Abspieler dreht ihn dabei auch auf: bräche
er mitten in einer Durchsage ab, bliebe die Zone sonst dauerhaft leise.

### Was der Pi wie erkennt

* **AirPlay** – `shairport-sync` ruft bei Beginn und Ende einer Sitzung
  `/usr/local/bin/emp-airplay-state` auf, das `/run/emp-audio/airplay.active`
  anlegt bzw. entfernt. Der Sendername steht dort nicht drin; im Dashboard
  erscheint deshalb nur „AirPlay".
* **Bluetooth** – ein verbundenes Gerät (`bluetoothctl devices Connected`) gilt
  als Übernahme. Wer sein Handy mit einem Lautsprecher verbindet, will darüber
  hören. Dessen Name landet im Dashboard.

Die Dienste heißen `emp-airplay`, `emp-bluealsa`, `emp-bluealsa-aplay` und
`emp-bt-agent`. Gestartet und gestoppt werden die ersten drei vom Abspieler, je
nachdem was die Zone eingeschaltet hat – von Hand aktivieren muss man sie nicht.

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
4. Die Ansage läuft, auf einheitlichen Pegel angehoben – bei `repeat > 1`
   mehrfach mit kurzer Pause.
5. Musik wird wieder hochgefahren, der Pi meldet `DONE`.

Der Gong wird beim ersten Start als `/var/lib/emp-audio/chime.wav` erzeugt.
Wer einen eigenen möchte, überschreibt einfach diese Datei.

## Fehlerbehebung

### Keine Wiedergabe, Logs zeigen „mpv ist nicht installiert"

```bash
sudo apt install mpv
sudo systemctl restart emp-audio
```

### Gar kein Ton, obwohl das Dashboard Wiedergabe zeigt

`isPlaying` heißt nur: der Befehl wurde abgeschickt. Ob mpv die Soundkarte
aufbekommt, steht seit Version 1.0.1 im Journal – Zeilen mit `mpv:` sind
Meldungen des Abspielers:

```bash
journalctl -u emp-audio -n 60 --no-pager | grep -i mpv
```

Endet das mit `Could not open/initialize audio device -> no sound`, hat mpv kein
Ausgabegerät bekommen. Steht davor `[ao/jack]` oder `[ao/sndio]`, fehlt die
`/etc/asound.conf` – dann `install-audio.sh` laufen lassen. Steht dort
`[ao/alsa]` mit `Device or resource busy`, hält ein anderer Prozess die Karte,
meist PipeWire.

Bei `unable to open slave` passt das `dmix` nicht zur Karte. Der Weg des Dienstes
lässt sich unabhängig davon prüfen, und der Vergleich sagt alles:

```bash
speaker-test -c2 -twav -l1 -D plughw:CARD=Headphones,DEV=0   # Karte direkt
speaker-test -c2 -twav -l1 -D default                        # Weg des Dienstes
```

Läuft der erste und scheitert der zweite, gehört die `/etc/asound.conf`
korrigiert – auf der Klinke ohne `dmix` (siehe oben).

Diesen Fall versucht der Abspieler drei Mal von selbst neu (nach 5, 10 und
15 Sekunden) – sonst bliebe die Zone nach jedem Auto-Update stumm, bis jemand im
Dashboard auf Start drückt. Läuft es beim dritten Mal noch nicht, hält etwas die
Karte dauerhaft belegt.

Seit Version 1.0.4 trägt jede Zeile ihre Priorität ins Journal, deshalb zeigt
`journalctl -u emp-audio -p warning` nur die Probleme – der Betriebsfunk der
Ausgabeschicht (welche Karte, welches Format) liegt auf INFO. Auf älteren
Versionen filtert das nichts, dort hilft nur:

```bash
journalctl -u emp-audio -n 100 --no-pager | grep -E "WARNING|ERROR"
```

Die drei häufigsten Ursachen, in dieser Reihenfolge prüfen:

```bash
aplay -l                                                # ist die Karte überhaupt da?
amixer -c Headphones sset Headphone 90% unmute          # Klinke ist oft stumm oder auf null
speaker-test -c2 -twav -l1 -D plughw:CARD=Headphones,DEV=0
```

Fehlt eine Karte `Headphones`, ist das Onboard-Audio aus: `dtparam=audio=on` in
`/boot/firmware/config.txt` eintragen und neu starten. Meldet `speaker-test`
„Device or resource busy", hält die Desktop-Sitzung die Karte über PipeWire fest
(siehe nächster Abschnitt). Kommt Rauschen, aber der Dienst bleibt stumm, spielt
mpv auf der falschen Karte – dann `install-audio.sh` erneut ausführen und die
richtige wählen.

### PipeWire der Desktop-Sitzung belegt die Karte

Auf Desktop-Images läuft PipeWire in der Sitzung des angemeldeten Benutzers. Der
Dienst läuft als `root` und kommt dort nicht heran; belegt PipeWire die Karte,
bleibt es still. Auf einem reinen Beschallungs-Pi wird PipeWire nicht gebraucht:

```bash
sudo runuser -u pi -- env XDG_RUNTIME_DIR=/run/user/1000 \
  systemctl --user mask --now pipewire.socket pipewire.service \
  pipewire-pulse.socket pipewire-pulse.service wireplumber.service
sudo systemctl restart emp-audio
```

Rückgängig geht das mit `systemctl --user unmask` auf denselben Units.

### Durchsage stumm, während Musik läuft

Zwei mpv-Prozesse greifen gleichzeitig auf die Soundkarte zu, und ohne
Mischgerät bekommt nur der erste sie auf. `install-audio.sh` legt dafür ein
`dmix`-Gerät in `/etc/asound.conf` an – fehlt die Datei oder steht dort eine
Karte mit exklusivem Zugriff (`plughw:` oder `hw:` direkt als `audio_device`),
das Skript erneut ausführen.

### Durchsage zu leise im Verhältnis zur Musik

Erst prüfen, ob der Pi mindestens Version 1.0.5 fährt – vorher gab es keine
Sprachanhebung, und über die Ansagelautstärke von 100 kommt man nicht hinaus:

```bash
journalctl -u emp-audio | grep "EMP Access Audio v" | tail -1
```

Bleibt es danach dabei, ist meist die Musik zu laut eingestellt: In der Zone den
Ducking-Pegel senken (Standard 15) statt die Ansage weiter hochzudrehen. Wer
eigene Ansagen hochlädt, sollte sie ausgesteuert exportieren; die Anhebung
rettet leise Aufnahmen, kann aber kein Rauschen wegzaubern.

### Die Schalter für AirPlay/Bluetooth bleiben im Dashboard gesperrt

Das Dashboard gibt sie erst frei, wenn der Abspieler den Dienst gemeldet hat. Zu
sehen ist das in den Gerätedetails unter `audio_backends`, auf dem Pi so:

```bash
journalctl -u emp-audio | grep -i "Empfänger" | tail -2
```

Steht dort „Kein AirPlay-/Bluetooth-Empfang eingerichtet", fehlt eines von
beiden – in dieser Reihenfolge prüfen:

```bash
grep emp_external /etc/asound.conf   # leer? Dann install-audio.sh erneut ausführen
which shairport-sync bluealsa-aplay  # fehlt das Paket?
```

Der Updater zieht nur den Code, nicht die apt-Pakete und nicht `/etc/asound.conf`
– beides richtet ausschließlich `install-audio.sh` ein. Ohne Ausgabegerät meldet
der Abspieler bewusst gar kein Backend: ohne den Regler davor wäre eine Durchsage
gegen den Sender nicht durchzusetzen.

### Ein Sender verbindet sich, aber es kommt kein Ton

Bei Bluetooth fehlt meist der zweite Dienst – die Verbindung allein macht noch
keinen Ton:

```bash
systemctl status emp-bluealsa emp-bluealsa-aplay
```

Bei AirPlay zuerst prüfen, ob der Dienst überhaupt läuft und die Zone im Netz
sichtbar ist:

```bash
systemctl status emp-airplay
avahi-browse -rt _raop._tcp          # taucht die Zone auf?
```

Läuft der Dienst nicht, fehlt `/etc/emp-airplay.conf`. Die schreibt der Abspieler
selbst, sobald die Zone AirPlay eingeschaltet hat – also erst den Schalter im
Dashboard setzen.

### Zone ist nach einer Übernahme dauerhaft leise

Der softvol-Regler steht auf dem Ducking-Pegel. Aufdrehen und den Dienst neu
starten, dann setzt er ihn beim Start selbst zurück:

```bash
amixer sset EmpExternal 100%
sudo systemctl restart emp-audio
```

### Die Zone ist am Handy nicht zu finden

Bluetooth ist nur im Kopplungsfenster sichtbar – auf der Zonenkarte im Dashboard
freigeben. Erscheint sie danach als „Sonstiges" statt als Lautsprecher, fehlt die
Geräteklasse in `/etc/bluetooth/main.conf`:

```bash
grep -E "Class|DiscoverableTimeout" /etc/bluetooth/main.conf
# erwartet: Class = 0x200414 und DiscoverableTimeout = 0
```

### „Keine Zone für Gerät #x hinterlegt"

Dem Gerät ist im Dashboard keine Zone zugewiesen. Unter **Audio → Zonen** die
Zone öffnen und den Abspieler auswählen; die Gerätedetails zeigen oben an,
welcher Zone das Gerät zugeordnet ist.

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
