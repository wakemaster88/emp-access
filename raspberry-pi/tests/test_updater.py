"""Auto-Updater: Vorab-Prüfung, Rollback, optionale Signaturprüfung."""

import json
import os
import shutil
import subprocess
import types
import unittest
from unittest import mock

import support
from support import ScannerTestCase, updater_mod

OLD = "a" * 40
NEW = "b" * 40


class FakeGit:
    """
    Ersetzt subprocess.run im Updater und spielt ein Repository nach:
    HEAD = OLD, origin/main = NEW, geänderte Datei unter raspberry-pi/.
    """

    def __init__(self):
        self.calls = []
        self.head = OLD
        self.remote = NEW
        self.changed = ["raspberry-pi/emp_scanner/main.py"]
        self.verify_ok = True
        self.ancestor_ok = True
        self.import_ok = True

    def __call__(self, cmd, **kwargs):
        self.calls.append(list(cmd))
        out, code = "", 0
        if cmd[:2] == ["git", "fetch"]:
            pass
        elif cmd == ["git", "rev-parse", "HEAD"]:
            out = self.head + "\n"
        elif cmd == ["git", "rev-parse", "origin/main"]:
            out = self.remote + "\n"
        elif cmd[:2] == ["git", "diff"]:
            out = "\n".join(self.changed) + "\n"
        elif cmd[:3] == ["git", "reset", "--hard"]:
            self.head = cmd[3]
        elif cmd[:2] == ["git", "verify-commit"]:
            code = 0 if self.verify_ok else 1
        elif cmd[:3] == ["git", "merge-base", "--is-ancestor"]:
            code = 0 if self.ancestor_ok else 1
        elif cmd[1:] == ["-c", "import emp_scanner.main"]:
            code = 0 if self.import_ok else 1
        else:
            raise AssertionError("unerwarteter Aufruf: %r" % (cmd,))
        return types.SimpleNamespace(returncode=code, stdout=out, stderr="fehler" if code else "")

    def resets(self):
        return [c[3] for c in self.calls if c[:3] == ["git", "reset", "--hard"]]

    def ran(self, *prefix):
        return any(c[:len(prefix)] == list(prefix) for c in self.calls)


class UpdaterTestCase(ScannerTestCase):
    def setUp(self):
        super().setUp()
        self.git = FakeGit()
        for target, value in (
            ("CONFIG_PATH", self.config_path),
            ("PACKAGE_DIR", self.make_package()),
        ):
            patcher = mock.patch.object(updater_mod, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch.object(updater_mod.subprocess, "run", self.git)
        patcher.start()
        self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop(updater_mod.VERIFY_ENV, None)

    def make_package(self, main_source="VALUE = 1\n"):
        """Minimales emp_scanner-Paket in einem Temp-Verzeichnis (kein requests nötig)."""
        pi_dir = os.path.join(self.tmpdir, "raspberry-pi")
        package = os.path.join(pi_dir, "emp_scanner")
        os.makedirs(package, exist_ok=True)
        with open(os.path.join(package, "__init__.py"), "w") as f:
            f.write("")
        with open(os.path.join(package, "main.py"), "w") as f:
            f.write(main_source)
        return pi_dir


class CheckAndUpdateTest(UpdaterTestCase):
    def test_no_update_when_up_to_date(self):
        self.git.remote = OLD

        self.assertFalse(updater_mod.check_and_update())
        self.assertEqual(self.git.resets(), [])

    def test_update_applied_when_preflight_passes(self):
        self.assertTrue(updater_mod.check_and_update())

        self.assertEqual(self.git.resets(), [NEW])
        self.assertEqual(self.git.head, NEW)

    def test_broken_update_is_rolled_back_without_restart(self):
        self.git.import_ok = False

        with mock.patch.object(updater_mod, "restart_service") as restart:
            updater_mod.run_update_check()

        self.assertEqual(self.git.resets(), [NEW, OLD])  # eingespielt, dann zurück
        self.assertEqual(self.git.head, OLD)
        restart.assert_not_called()

    def test_syntax_error_is_rolled_back(self):
        self.make_package(main_source="def kaputt(:\n")

        self.assertFalse(updater_mod.check_and_update())

        self.assertEqual(self.git.resets(), [NEW, OLD])
        # der Import-Test wird gar nicht erst gestartet
        self.assertFalse(self.git.ran(support.sys.executable))

    def test_cloud_only_update_needs_no_preflight_and_no_restart(self):
        self.git.changed = []
        self.git.import_ok = False

        self.assertFalse(updater_mod.check_and_update())

        self.assertEqual(self.git.resets(), [NEW])
        self.assertEqual(self.git.head, NEW)

    def test_unknown_current_commit_skips_update(self):
        self.git.head = ""

        self.assertFalse(updater_mod.check_and_update())
        self.assertEqual(self.git.resets(), [])


class SignatureCheckTest(UpdaterTestCase):
    def test_disabled_by_default(self):
        self.assertFalse(updater_mod.signature_check_enabled())

        self.assertTrue(updater_mod.check_and_update())
        self.assertFalse(self.git.ran("git", "verify-commit"))

    def test_disabled_by_default_with_existing_config(self):
        self.write_configured()
        self.assertFalse(updater_mod.signature_check_enabled())

    def test_enabled_by_env(self):
        for value in ("1", "true", "YES", "on"):
            with self.subTest(value=value):
                os.environ[updater_mod.VERIFY_ENV] = value
                self.assertTrue(updater_mod.signature_check_enabled())
        for value in ("", "0", "false", "off"):
            with self.subTest(value=value):
                os.environ[updater_mod.VERIFY_ENV] = value
                self.assertFalse(updater_mod.signature_check_enabled())

    def test_enabled_by_config_flag(self):
        self.write_configured(update_verify_signature=True)
        self.assertTrue(updater_mod.signature_check_enabled())

    def test_unsigned_commit_is_refused(self):
        os.environ[updater_mod.VERIFY_ENV] = "1"
        self.git.verify_ok = False

        self.assertFalse(updater_mod.check_and_update())

        self.assertTrue(self.git.ran("git", "verify-commit", NEW))
        self.assertEqual(self.git.resets(), [])
        self.assertEqual(self.git.head, OLD)

    def test_non_fast_forward_is_refused(self):
        os.environ[updater_mod.VERIFY_ENV] = "1"
        self.git.ancestor_ok = False

        self.assertFalse(updater_mod.check_and_update())

        self.assertTrue(self.git.ran("git", "merge-base", "--is-ancestor", OLD, NEW))
        self.assertEqual(self.git.resets(), [])

    def test_signed_fast_forward_is_applied(self):
        os.environ[updater_mod.VERIFY_ENV] = "1"

        self.assertTrue(updater_mod.check_and_update())

        self.assertTrue(self.git.ran("git", "verify-commit", NEW))
        self.assertEqual(self.git.resets(), [NEW])


class PreflightTest(ScannerTestCase):
    """preflight_check() mit echtem Python-Unterprozess gegen ein Temp-Paket."""

    def make_package(self, files):
        pi_dir = os.path.join(self.tmpdir, "raspberry-pi")
        package = os.path.join(pi_dir, "emp_scanner")
        os.makedirs(package)
        for name, source in files.items():
            with open(os.path.join(package, name), "w") as f:
                f.write(source)
        return pi_dir

    def preflight(self, files):
        with mock.patch.object(updater_mod, "PACKAGE_DIR", self.make_package(files)):
            return updater_mod.preflight_check()

    def test_passes_for_importable_package(self):
        self.assertTrue(self.preflight({
            "__init__.py": "",
            "main.py": "from emp_scanner import helper\n",
            "helper.py": "X = 1\n",
        }))

    def test_fails_on_syntax_error_in_any_module(self):
        self.assertFalse(self.preflight({
            "__init__.py": "",
            "main.py": "X = 1\n",
            "helper.py": "def kaputt(:\n",  # wird von main gar nicht importiert
        }))

    def test_fails_when_entry_module_cannot_be_imported(self):
        self.assertFalse(self.preflight({
            "__init__.py": "",
            "main.py": "import modul_das_es_nicht_gibt_xyz\n",
        }))

    def test_fails_when_entry_module_raises(self):
        self.assertFalse(self.preflight({
            "__init__.py": "",
            "main.py": "raise RuntimeError('kaputt')\n",
        }))

    def test_real_package_compiles(self):
        # Syntax-Teil der Vorab-Prüfung gegen den echten Quellcode.
        package = os.path.join(support.PI_DIR, "emp_scanner")
        for name in sorted(os.listdir(package)):
            if name.endswith(".py"):
                with self.subTest(module=name):
                    path = os.path.join(package, name)
                    with open(path, "rb") as f:
                        compile(f.read(), path, "exec")


@unittest.skipUnless(shutil.which("git"), "git nicht installiert")
class RealGitRollbackTest(ScannerTestCase):
    """Ende-zu-Ende mit echten Git-Repositories in einem Temp-Verzeichnis."""

    def setUp(self):
        super().setUp()
        self.env = dict(os.environ)
        self.env.update({
            "HOME": self.tmpdir,
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.invalid",
            "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.invalid",
        })
        self.env.pop(updater_mod.VERIFY_ENV, None)
        self.origin = os.path.join(self.tmpdir, "origin")
        self.device = os.path.join(self.tmpdir, "device")

        os.makedirs(self.origin)
        self.git(self.origin, "init", "-q")
        self.git(self.origin, "symbolic-ref", "HEAD", "refs/heads/main")
        self.good = self.commit({"__init__.py": "", "main.py": "VALUE = 1\n"}, "gut")
        self.git(self.tmpdir, "clone", "-q", self.origin, self.device)

        for target, value in (
            ("PROJECT_DIR", self.device),
            ("PACKAGE_DIR", os.path.join(self.device, "raspberry-pi")),
            ("CONFIG_PATH", self.config_path),
        ):
            patcher = mock.patch.object(updater_mod, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ, self.env, clear=True)
        env.start()
        self.addCleanup(env.stop)

    def git(self, cwd, *args):
        # Nie außerhalb des Temp-Verzeichnisses arbeiten.
        self.assertTrue(os.path.realpath(cwd).startswith(os.path.realpath(self.tmpdir)))
        result = subprocess.run(
            ["git", "-c", "commit.gpgsign=false"] + list(args),
            cwd=cwd, env=self.env, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def commit(self, files, message):
        package = os.path.join(self.origin, "raspberry-pi", "emp_scanner")
        os.makedirs(package, exist_ok=True)
        for name, source in files.items():
            with open(os.path.join(package, name), "w") as f:
                f.write(source)
        self.git(self.origin, "add", "-A")
        self.git(self.origin, "commit", "-q", "-m", message)
        return self.git(self.origin, "rev-parse", "HEAD")

    def device_head(self):
        return self.git(self.device, "rev-parse", "HEAD")

    def device_main_source(self):
        with open(os.path.join(self.device, "raspberry-pi", "emp_scanner", "main.py")) as f:
            return f.read()

    def test_broken_commit_is_rolled_back_then_fixed_commit_is_applied(self):
        self.assertEqual(self.device_head(), self.good)

        self.commit({"main.py": "def kaputt(:\n"}, "kaputt (Syntax)")
        self.assertFalse(updater_mod.check_and_update())
        self.assertEqual(self.device_head(), self.good)
        self.assertEqual(self.device_main_source(), "VALUE = 1\n")

        self.commit({"main.py": "import modul_das_es_nicht_gibt_xyz\n"}, "kaputt (Import)")
        self.assertFalse(updater_mod.check_and_update())
        self.assertEqual(self.device_head(), self.good)
        self.assertEqual(self.device_main_source(), "VALUE = 1\n")

        fixed = self.commit({"main.py": "VALUE = 2\n"}, "repariert")
        self.assertTrue(updater_mod.check_and_update())
        self.assertEqual(self.device_head(), fixed)
        self.assertEqual(self.device_main_source(), "VALUE = 2\n")

    def test_unsigned_commit_is_refused_when_signature_check_enabled(self):
        newer = self.commit({"main.py": "VALUE = 3\n"}, "unsigniert")
        os.environ[updater_mod.VERIFY_ENV] = "1"

        self.assertFalse(updater_mod.check_and_update())
        self.assertEqual(self.device_head(), self.good)

        # ohne Signaturprüfung (Standard) wird derselbe Commit übernommen
        del os.environ[updater_mod.VERIFY_ENV]
        self.assertTrue(updater_mod.check_and_update())
        self.assertEqual(self.device_head(), newer)


if __name__ == "__main__":
    unittest.main()
