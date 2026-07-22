#!/usr/bin/env python3
"""Importiert die im Scan gefundenen Reolink-Cams via API."""

import json
import re
import sys
import unicodedata
import urllib.request
import urllib.error

PASSWORD = "adminBeckum2013!"
USERNAME = "admin"
API = "http://localhost:3000"

CAMS = [
    ("192.168.1.69", "RLC-811A", "Seilbahn B - Schanze 2"),
    ("192.168.1.72", "RLC-510A", "Imbiss"),
    ("192.168.1.74", "RLC-823A 16X", "Insel B"),
    ("192.168.1.86", "RLC-811A", "Eingang"),
    ("192.168.1.101", "RLC-811A", "Schanze 1"),
    ("192.168.1.103", "RLC-811A", "Startdock B"),
    ("192.168.1.117", "RLC-823S1", "Halle"),
    ("192.168.1.143", "RLC-810A", "Umkleiden"),
]


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s


def post(path, body):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, None


def get(path: str):
    with urllib.request.urlopen(f"{API}{path}", timeout=10) as r:
        return json.loads(r.read())


def main() -> int:
    for ip, model, name in CAMS:
        slug = slugify(name)
        cam_id = f"cam-{slug}"
        widget_id = f"w-{slug}"

        print(f"→ {cam_id}  ({model} @ {ip})  '{name}'")

        status, body = post(
            "/api/cams",
            {
                "id": cam_id,
                "name": name,
                "model": model,
                "ip": ip,
                "port": 80,
                "rtspPort": 554,
                "username": USERNAME,
                "password": PASSWORD,
                "channel": 0,
                "streamMain": "h264Preview_01_main",
                "streamSub": "h264Preview_01_sub",
                "enabled": True,
            },
        )
        if status == 200 and body and body.get("ok"):
            print("  ✓ Cam angelegt")
        else:
            err = (body or {}).get("error", "?")
            print(f"  ✗ Cam: {err}")

        status, body = post(
            "/api/widgets",
            {
                "id": widget_id,
                "type": "reolink",
                "title": name,
                "camId": cam_id,
                "enabled": True,
                "showTitleBar": True,
            },
        )
        if status == 200 and body and body.get("ok"):
            print("  ✓ Widget angelegt")
        else:
            err = (body or {}).get("error", "?")
            print(f"  ✗ Widget: {err}")

    print("\nKonfigurierte Cams:")
    for c in get("/api/cams"):
        print(f"  - {c['name']}  ({c['model']} @ {c['ip']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
