"""
Collect Raspberry Pi system information for heartbeat reports.
All values are read from /proc and /sys – no external dependencies needed.
"""

import os
import time
import socket
import platform
import logging

logger = logging.getLogger("emp.sysinfo")


def get_cpu_temp() -> float | None:
    """CPU temperature in °C from thermal zone."""
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return round(int(f.read().strip()) / 1000.0, 1)
    except Exception:
        return None


def get_gpu_temp() -> float | None:
    """GPU temperature via vcgencmd (Pi-specific)."""
    try:
        import subprocess
        result = subprocess.run(
            ["vcgencmd", "measure_temp"],
            capture_output=True, text=True, timeout=3,
        )
        # Output: "temp=42.8'C"
        temp_str = result.stdout.strip().replace("temp=", "").replace("'C", "")
        return round(float(temp_str), 1)
    except Exception:
        return None


def get_cpu_usage() -> float | None:
    """CPU usage percentage (1-second sample from /proc/stat)."""
    try:
        def read_stat():
            with open("/proc/stat") as f:
                parts = f.readline().split()
            return [int(x) for x in parts[1:]]

        s1 = read_stat()
        time.sleep(0.5)
        s2 = read_stat()

        delta = [s2[i] - s1[i] for i in range(len(s1))]
        total = sum(delta)
        idle = delta[3] + (delta[4] if len(delta) > 4 else 0)
        if total == 0:
            return 0.0
        return round((1 - idle / total) * 100, 1)
    except Exception:
        return None


def get_memory() -> dict | None:
    """Memory info from /proc/meminfo. Returns MB values."""
    try:
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                parts = line.split()
                key = parts[0].rstrip(":")
                info[key] = int(parts[1])  # kB

        total = info.get("MemTotal", 0)
        available = info.get("MemAvailable", info.get("MemFree", 0))
        used = total - available
        return {
            "total_mb": round(total / 1024),
            "used_mb": round(used / 1024),
            "available_mb": round(available / 1024),
            "percent": round(used / total * 100, 1) if total > 0 else 0,
        }
    except Exception:
        return None


def get_disk() -> dict | None:
    """Root filesystem disk usage."""
    try:
        stat = os.statvfs("/")
        total = stat.f_blocks * stat.f_frsize
        free = stat.f_bavail * stat.f_frsize
        used = total - free
        return {
            "total_gb": round(total / (1024 ** 3), 1),
            "used_gb": round(used / (1024 ** 3), 1),
            "free_gb": round(free / (1024 ** 3), 1),
            "percent": round(used / total * 100, 1) if total > 0 else 0,
        }
    except Exception:
        return None


def get_uptime() -> dict | None:
    """System uptime from /proc/uptime."""
    try:
        with open("/proc/uptime") as f:
            seconds = float(f.read().split()[0])
        days = int(seconds // 86400)
        hours = int((seconds % 86400) // 3600)
        minutes = int((seconds % 3600) // 60)
        return {
            "seconds": int(seconds),
            "formatted": f"{days}d {hours}h {minutes}m" if days > 0 else f"{hours}h {minutes}m",
        }
    except Exception:
        return None


def get_network() -> dict | None:
    """Network information – IP address and hostname."""
    try:
        hostname = socket.gethostname()
        # Get primary IP (not localhost)
        ip = None
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
        except Exception:
            pass

        # WiFi signal strength
        wifi_signal = None
        try:
            with open("/proc/net/wireless") as f:
                lines = f.readlines()
                if len(lines) >= 3:
                    parts = lines[2].split()
                    wifi_signal = int(float(parts[3]))
        except Exception:
            pass

        return {
            "hostname": hostname,
            "ip": ip,
            "wifi_signal_dbm": wifi_signal,
        }
    except Exception:
        return None


def get_pi_model() -> str | None:
    """Raspberry Pi model from /proc/device-tree/model."""
    try:
        with open("/proc/device-tree/model") as f:
            return f.read().strip().rstrip("\x00")
    except Exception:
        return None


def get_os_info() -> dict:
    """OS and Python version."""
    try:
        os_release = {}
        if os.path.exists("/etc/os-release"):
            with open("/etc/os-release") as f:
                for line in f:
                    if "=" in line:
                        key, val = line.strip().split("=", 1)
                        os_release[key] = val.strip('"')
        return {
            "os": os_release.get("PRETTY_NAME", platform.platform()),
            "kernel": platform.release(),
            "python": platform.python_version(),
            "arch": platform.machine(),
        }
    except Exception:
        return {"os": platform.platform(), "python": platform.python_version()}


def get_cpu_freq() -> int | None:
    """Current CPU frequency in MHz."""
    try:
        with open("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq") as f:
            return int(f.read().strip()) // 1000
    except Exception:
        return None


def get_throttle_state() -> dict | None:
    """Check for throttling/undervoltage (Pi-specific vcgencmd)."""
    try:
        import subprocess
        result = subprocess.run(
            ["vcgencmd", "get_throttled"],
            capture_output=True, text=True, timeout=3,
        )
        # Output: "throttled=0x0"
        hex_val = int(result.stdout.strip().split("=")[1], 16)
        return {
            "undervoltage_now": bool(hex_val & 0x1),
            "throttled_now": bool(hex_val & 0x4),
            "undervoltage_occurred": bool(hex_val & 0x10000),
            "throttled_occurred": bool(hex_val & 0x40000),
        }
    except Exception:
        return None


def collect_system_info() -> dict:
    """Collect all available system information."""
    from emp_scanner import VERSION

    info: dict = {"scanner_version": VERSION}

    cpu_temp = get_cpu_temp()
    if cpu_temp is not None:
        info["cpu_temp"] = cpu_temp

    gpu_temp = get_gpu_temp()
    if gpu_temp is not None:
        info["gpu_temp"] = gpu_temp

    cpu_usage = get_cpu_usage()
    if cpu_usage is not None:
        info["cpu_usage"] = cpu_usage

    cpu_freq = get_cpu_freq()
    if cpu_freq is not None:
        info["cpu_freq_mhz"] = cpu_freq

    memory = get_memory()
    if memory:
        info["memory"] = memory

    disk = get_disk()
    if disk:
        info["disk"] = disk

    uptime = get_uptime()
    if uptime:
        info["uptime"] = uptime

    network = get_network()
    if network:
        info["network"] = network

    model = get_pi_model()
    if model:
        info["model"] = model

    os_info = get_os_info()
    if os_info:
        info["os"] = os_info

    throttle = get_throttle_state()
    if throttle:
        info["throttle"] = throttle

    return info
