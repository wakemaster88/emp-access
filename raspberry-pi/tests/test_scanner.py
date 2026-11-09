"""Scanner-Eingabe: is_alive() spiegelt den Zustand des Lese-Threads."""

import threading
import unittest
from unittest import mock

import support  # noqa: F401  (Stubs vor dem Import von emp_scanner)
from support import wait_for
from emp_scanner import scanner as scanner_mod


class ScannerAliveTest(unittest.TestCase):
    def test_not_alive_before_start(self):
        scanner = scanner_mod.ScannerInput(on_scan=lambda code: None, device_path="stdin")
        self.assertFalse(scanner.is_alive())

    def test_alive_while_reading_and_dead_after_stdin_closes(self):
        release = threading.Event()
        codes = []

        def fake_input(_prompt=""):
            # erster Aufruf liefert einen Code, danach blockiert stdin bis zum "Schließen"
            if not codes:
                return "TICKET-123456"
            release.wait(5)
            raise EOFError

        scanner = scanner_mod.ScannerInput(on_scan=codes.append, device_path="stdin")
        with mock.patch("builtins.input", fake_input):
            scanner.start()
            self.assertTrue(wait_for(lambda: codes == ["TICKET-123456"]))
            self.assertTrue(scanner.is_alive())

            release.set()  # stdin geschlossen → Thread endet
            self.assertTrue(wait_for(lambda: not scanner.is_alive()))


if __name__ == "__main__":
    unittest.main()
