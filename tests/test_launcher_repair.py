"""Checks for startup regressions that previously hid installer errors."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StartupRepairTests(unittest.TestCase):
    def test_repair_is_persistent_and_logged(self):
        launcher = (ROOT / 'REPAIR-Janna.cmd').read_text(encoding='utf8').lower()
        installer = (ROOT / 'scripts' / 'Install-Janna.ps1').read_text(encoding='utf8').lower()
        self.assertIn('pause', launcher)
        self.assertIn('install-janna.ps1', launcher)
        self.assertIn('start-transcript', installer)
        self.assertIn('stop-transcript', installer)
        self.assertIn('setup log:', installer)

    def test_start_uses_repair_instead_of_hidden_setup(self):
        launcher = (ROOT / 'START-Janna.cmd').read_text(encoding='utf8').lower()
        self.assertIn('repair-janna.cmd', launcher)
        self.assertIn('app_failed', launcher)
        self.assertNotIn('start "" "%~dp0janna-setup.exe"', launcher)

    def test_desktop_exposes_diagnostics(self):
        host = (ROOT / 'desktop' / 'Janna.Desktop' / 'Program.cs').read_text(encoding='utf8')
        self.assertIn('desktop-', host)
        self.assertIn('RedirectStandardError = true', host)
        self.assertIn('Open diagnostics folder', host)
        self.assertIn('ShowStartupError(error)', host)


if __name__ == '__main__':
    unittest.main()
