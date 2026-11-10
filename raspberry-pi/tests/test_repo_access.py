"""Deploy-Key-Zugang: URL-Umbau, Umstellung auf SSH erst nach Freigabe."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

import support  # noqa: F401  (setzt sys.path)
from emp_scanner import repo_access


class UrlTest(unittest.TestCase):
    def test_https_to_ssh(self):
        for url in (
            "https://github.com/wakemaster88/emp-access.git",
            "https://github.com/wakemaster88/emp-access",
            "https://token@github.com/wakemaster88/emp-access.git",
        ):
            self.assertEqual(
                repo_access.ssh_url_for(url),
                "ssh://git@ssh.github.com:443/wakemaster88/emp-access.git",
            )

    def test_non_github_is_left_alone(self):
        self.assertIsNone(repo_access.ssh_url_for("https://gitlab.com/a/b.git"))

    def test_is_ssh_url(self):
        self.assertTrue(repo_access.is_ssh_url("ssh://git@ssh.github.com:443/a/b.git"))
        self.assertTrue(repo_access.is_ssh_url("git@github.com:a/b.git"))
        self.assertFalse(repo_access.is_ssh_url("https://github.com/a/b.git"))


@unittest.skipUnless(shutil.which("git") and shutil.which("ssh-keygen"), "git/ssh-keygen fehlt")
class EnsureRepoAccessTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        key_dir = os.path.join(self.tmp, "etc")
        for name, value in {
            "KEY_DIR": key_dir,
            "KEY_PATH": os.path.join(key_dir, "github_deploy_ed25519"),
            "KNOWN_HOSTS_PATH": os.path.join(key_dir, "github_known_hosts"),
            "STATUS_PATH": os.path.join(key_dir, "repo_access.json"),
        }.items():
            p = mock.patch.object(repo_access, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.repo = os.path.join(self.tmp, "repo")
        subprocess.run(["git", "init", "-q", self.repo], check=True)
        subprocess.run(
            ["git", "-C", self.repo, "remote", "add", "origin", "https://github.com/o/r.git"], check=True,
        )

    def remote(self):
        return subprocess.run(
            ["git", "-C", self.repo, "remote", "get-url", "origin"], capture_output=True, text=True,
        ).stdout.strip()

    def run_with_probe(self, ok):
        real = repo_access._git

        def fake(project_dir, *args, **kw):
            if args and args[0] == "ls-remote":
                return subprocess.CompletedProcess(args, 0 if ok else 128, "", "" if ok else "Permission denied (publickey).")
            return real(project_dir, *args, **kw)

        with mock.patch.object(repo_access, "_git", side_effect=fake):
            return repo_access.ensure_repo_access(self.repo)

    def test_key_created_but_https_kept_until_registered(self):
        status = self.run_with_probe(ok=False)
        self.assertEqual(status["mode"], "https")
        self.assertTrue(status["public_key"].startswith("ssh-ed25519 "))
        self.assertIn("publickey", status["error"])
        self.assertEqual(self.remote(), "https://github.com/o/r.git")
        self.assertEqual(oct(os.stat(repo_access.KEY_PATH).st_mode & 0o777), "0o600")
        with open(repo_access.STATUS_PATH) as f:
            self.assertEqual(json.load(f)["mode"], "https")

    def test_switches_to_ssh_once_key_is_accepted(self):
        first = self.run_with_probe(ok=False)
        status = self.run_with_probe(ok=True)
        self.assertEqual(status["mode"], "ssh")
        self.assertEqual(status["public_key"], first["public_key"])  # Schluessel bleibt
        self.assertEqual(self.remote(), "ssh://git@ssh.github.com:443/o/r.git")
        ssh_cmd = subprocess.run(
            ["git", "-C", self.repo, "config", "core.sshCommand"], capture_output=True, text=True,
        ).stdout
        self.assertIn(repo_access.KEY_PATH, ssh_cmd)
        self.assertEqual(repo_access.read_status()["mode"], "ssh")

    def test_known_hosts_matches_both_hosts(self):
        repo_access.ensure_key()
        for host in ("github.com", "[ssh.github.com]:443"):
            found = subprocess.run(
                ["ssh-keygen", "-F", host, "-f", repo_access.KNOWN_HOSTS_PATH], capture_output=True, text=True,
            )
            self.assertEqual(found.returncode, 0, host)


if __name__ == "__main__":
    unittest.main()
