"""Audio-Abspieler: Empfängername für die AirPlay-/Bluetooth-Konfiguration."""

import unittest

import support  # noqa: F401  (stubbt Fremdpakete, muss zuerst kommen)
from emp_audio import external


class CleanNameTest(unittest.TestCase):
    def test_sichtbare_namen_bleiben(self):
        self.assertEqual(external.clean_name("Bar & Terrasse (Süd)"), "Bar & Terrasse (Süd)")
        self.assertEqual(external.clean_name("  Strand  "), "Strand")

    def test_zeichen_die_den_wert_verlassen_fallen_weg(self):
        self.assertEqual(external.clean_name('Bar"; x = "y'), "Bar; x = y")
        self.assertEqual(external.clean_name("Bar\\"), "Bar")
        self.assertEqual(external.clean_name("Bar\nzweite Zeile\r\t"), "Barzweite Zeile")
        self.assertEqual(external.clean_name("Bar x\x7f"), "Barx")

    def test_laenge_wird_begrenzt(self):
        self.assertEqual(len(external.clean_name("x" * 200)), external.MAX_NAME)


if __name__ == "__main__":
    unittest.main()
