/**
 * Einrichtungsskript fuer neue Raspberry Pis (ausgeliefert ueber
 * /api/devices/pi/bootstrap). Siehe dort.
 */

const REPO = "wakemaster88/emp-access";

/** Muss zu raspberry-pi/emp_scanner/repo_access.py passen (Pfade, Host, Host-Schluessel). */
export function piBootstrapScript(kind: "scanner" | "audio"): string {
  const installDir = kind === "audio" ? "/opt/emp-audio" : "/opt/emp-scanner";
  const installer = kind === "audio" ? "install-audio.sh" : "install.sh";
  return `#!/bin/bash
# EMP Access – Raspberry Pi einrichten (${kind === "audio" ? "Audio-Abspieler" : "Scanner"})
set -e

if [ "$EUID" -ne 0 ]; then
    echo "Bitte mit sudo ausfuehren:  curl -sSL <Adresse> | sudo bash"
    exit 1
fi

REPO="${REPO}"
HTTPS_URL="https://github.com/$REPO.git"
SSH_URL="ssh://git@ssh.github.com:443/$REPO.git"
INSTALL_DIR="${installDir}"
KEY_DIR="/etc/emp-access"
KEY="$KEY_DIR/github_deploy_ed25519"
KNOWN="$KEY_DIR/github_known_hosts"
HOSTKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"

echo "→ git und ssh bereitstellen..."
if ! command -v git >/dev/null 2>&1 || ! command -v ssh-keygen >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq git openssh-client
fi

mkdir -p "$KEY_DIR"
chmod 755 "$KEY_DIR"
printf 'github.com %s\\n[ssh.github.com]:443 %s\\n' "$HOSTKEY" "$HOSTKEY" > "$KNOWN"
if [ ! -f "$KEY" ]; then
    ssh-keygen -q -t ed25519 -N "" -C "emp-access $(hostname)" -f "$KEY"
fi
chmod 600 "$KEY"
export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile=$KNOWN -o StrictHostKeyChecking=yes -o ConnectTimeout=15"

if GIT_TERMINAL_PROMPT=0 git ls-remote "$HTTPS_URL" HEAD >/dev/null 2>&1; then
    URL="$HTTPS_URL"
else
    until git ls-remote "$SSH_URL" HEAD >/dev/null 2>&1; do
        echo ""
        echo "════════════════════════════════════════════════════════════"
        echo "  Dieses Geraet braucht Lesezugriff auf das Repository."
        echo "  GitHub → $REPO → Settings → Deploy keys → Add deploy key"
        echo "  Titel: $(hostname), Schreibzugriff NICHT erlauben, Schluessel:"
        echo ""
        cat "$KEY.pub"
        echo "════════════════════════════════════════════════════════════"
        read -r -p "Eingetragen? Enter druecken zum Pruefen (Strg+C bricht ab) " _ < /dev/tty
    done
    URL="$SSH_URL"
fi

if [ -d "$INSTALL_DIR/.git" ]; then
    # Bestehende Installation (auch ein Pi mit altem Stand, der ein privates
    # Repo nicht mehr lesen kann): auf den erreichbaren Zugang umstellen und
    # den aktuellen Stand holen, bevor dessen Installer laeuft.
    echo "→ $INSTALL_DIR aktualisieren ($URL)..."
    case "$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null)" in
        ssh://*|git@*) : ;;
        *) git -C "$INSTALL_DIR" remote set-url origin "$URL" ;;
    esac
    git -C "$INSTALL_DIR" fetch origin
    git -C "$INSTALL_DIR" reset --hard origin/main
else
    echo "→ Repository klonen ($URL)..."
    git clone "$URL" "$INSTALL_DIR"
fi

case "$(git -C "$INSTALL_DIR" remote get-url origin)" in
    ssh://*|git@*) git -C "$INSTALL_DIR" config core.sshCommand "$GIT_SSH_COMMAND" ;;
esac

exec bash "$INSTALL_DIR/raspberry-pi/${installer}" < /dev/tty
`;
}
