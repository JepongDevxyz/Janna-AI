"""The web shell offers System/Light/Dark; the desktop keeps the 60+ theme
catalog, and every theme id there matches the native title bar."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ThemeCatalogTests(unittest.TestCase):
    def test_desktop_theme_catalog_agrees_and_web_shell_offers_system_light_dark(self):
        # The desktop server still carries the 60+ theme catalog and the
        # native title bar must list the same ids (minus porcelain, which
        # maps to light). The WEB shell has no such catalog: since the grok
        # rebuild (v47+, fresh-reset v68) it offers only System / Light /
        # Dark, and styles.css keeps every legacy stored theme id painting
        # so an old stored choice never renders unstyled.
        server = (ROOT / 'janna' / 'server.py').read_text(encoding='utf-8')
        allowed = re.search(r'"theme": \[(.*?)\]', server, re.S)
        self.assertIsNotNone(allowed)
        server_ids = re.findall(r'"([a-z]{2,16})"', allowed.group(1))
        title = (ROOT / 'desktop' / 'Janna.Desktop' / 'JannaTitleBar.cs').read_text(encoding='utf-8')
        title_ids = re.findall(r'"([a-z]{2,16})" =>', title)
        self.assertEqual(set(server_ids), set(title_ids) | {'porcelain'})
        self.assertEqual(len(server_ids), len(set(server_ids)))
        self.assertGreaterEqual(len(server_ids), 60)
        for ident in server_ids:
            self.assertRegex(ident, r'^[a-z]{2,16}$')
        app = (ROOT / 'web' / 'app.js').read_text(encoding='utf-8')
        self.assertIn("for (const m of ['system', 'light', 'dark'])", app)
        css = (ROOT / 'web' / 'styles.css').read_text(encoding='utf-8')
        for ident in ('dark', 'velvet', 'midnight', 'pro', 'rose', 'porcelain'):
            self.assertIn("body[data-theme='%s']" % ident, css)


def _luminance(color):
    channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4 for c in channels]
    return .2126 * r + .7152 * g + .0722 * b


def _contrast(one, two):
    high, low = sorted((_luminance(one), _luminance(two)), reverse=True)
    return (high + .05) / (low + .05)


class ColorThemeTests(unittest.TestCase):
    def setUp(self):
        self.app = (ROOT / 'web' / 'app.js').read_text(encoding='utf-8')
        self.css = (ROOT / 'web' / 'styles.css').read_text(encoding='utf-8')
        # The grok shell has exactly two themes — light (:root) and dark
        # (body[data-theme='dark']). There is no COLOR_THEMES catalog and
        # no ember theme; those belonged to the pre-grok shell.
        root = re.search(r':root\{(.*?)\}', self.css, re.S)
        dark = re.search(r"body\[data-theme='dark'\][^{]*\{(.*?)\}", self.css, re.S)
        self.assertIsNotNone(root)
        self.assertIsNotNone(dark)
        self.themes = {
            'light': dict(re.findall(r'--([a-z]+):(#[0-9a-f]{6})', root.group(1))),
            'dark': dict(re.findall(r'--([a-z]+):(#[0-9a-f]{6})', dark.group(1))),
        }

    def test_web_shell_has_two_themes_not_a_color_catalog(self):
        self.assertNotIn('COLOR_THEMES', self.app)
        self.assertNotIn('JANNA_THEMES', self.app)
        self.assertIn("for (const m of ['system', 'light', 'dark'])", self.app)
        self.assertEqual(set(self.themes), {'light', 'dark'})

    def test_text_stays_readable_on_every_color_theme(self):
        for name, values in self.themes.items():
            with self.subTest(theme=name):
                self.assertGreaterEqual(_contrast(values['ink'], values['paper']), 7)
                self.assertGreaterEqual(_contrast(values['muted'], values['paper']), 4.5)
                self.assertGreaterEqual(_contrast(values['faded'], values['paper']), 3)
                self.assertGreaterEqual(_contrast(values['ink'], values['bubble']), 7)


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.app = (ROOT / 'web' / 'app.js').read_text(encoding='utf-8')
        self.body = self.app[self.app.index('function renderSettingsBody('):]

    def test_settings_has_groks_nine_sections_in_order_with_bodies(self):
        # Settings is grok's 9-section page since v62 (fresh-reset v68 kept
        # it): the old drawSettings() page with General / Personalization /
        # "How hard Janna works" etc. is gone.
        match = re.search(r"const SETTING_SECTIONS = \[(.*?)\];", self.app, re.S)
        self.assertIsNotNone(match)
        sections = re.findall(r"'([a-z]+)'", match.group(1))
        expected = ['account', 'appearance', 'behavior', 'notifications',
                    'customize', 'connectors', 'skills', 'automations', 'data']
        self.assertEqual(sections, expected)
        labels = re.search(r"const SETTING_LABELS = \{(.*?)\};", self.app, re.S)
        self.assertIsNotNone(labels)
        names = dict(re.findall(r"([a-z]+): '([^']+)'", labels.group(1)))
        self.assertEqual([names[s] for s in expected],
                         ['Account', 'Appearance', 'Behavior', 'Notifications',
                          'Customize', 'Connect Apps', 'Skills', 'Automations',
                          'Data Controls'])
        heads = [(m.start(), m.group(1)) for m in re.finditer(r"section === '([a-z]+)'", self.body)]
        self.assertEqual([name for _, name in heads], expected)
        positions = [pos for pos, _ in heads]
        self.assertEqual(positions, sorted(positions))
        for i, pos in enumerate(positions):
            end = positions[i + 1] if i + 1 < len(positions) else len(self.body)
            self.assertGreater(end - pos, 120, expected[i])

    def test_settings_controls_persist_locally_and_offer_system_light_dark(self):
        # The web shell's settings are local (persistSettings), not the
        # desktop server's allowed-keys map: a desktop-server control such
        # as repair_generated_html must not appear as a web control.
        self.assertIn("for (const m of ['system', 'light', 'dark'])", self.body)
        self.assertIn("persistSettings({ appearance_mode:", self.body)
        self.assertIn('state.settings.appearance_mode', self.body)
        self.assertIn('Clear all chats', self.body)
        self.assertIn('Export all chats', self.body)
        self.assertNotIn('repair_generated_html', self.app)
        # Stored by the backend but never read, so a control for it would do nothing.
        self.assertNotIn('autonomy_passes', self.body)


class LanguageNoteTests(unittest.TestCase):
    def test_menu_does_not_claim_translation_it_does_not_have(self):
        from janna.language import language_menu, model_instruction
        menu = {row['id']: row for row in language_menu()}
        self.assertEqual(menu['en']['chrome'], 'full')
        self.assertEqual(menu['it']['chrome'], 'partial')
        self.assertEqual({row['chrome'] for code, row in menu.items() if code not in ('en', 'it')}, {'english'})
        self.assertEqual((menu['ar']['dir'], menu['he']['dir']), ('rtl', 'rtl'))
        self.assertIn('professional Italian', model_instruction('it'))


class SavedSettingsTests(unittest.TestCase):
    def test_browser_tools_stay_on_after_a_restart(self):
        server = (ROOT / 'janna' / 'server.py').read_text(encoding='utf-8')
        defaults = server[server.index('self.settings = {'):server.index('"send_on_enter": True')]
        self.assertIn('"browser_enabled": False', defaults)


if __name__ == '__main__':
    unittest.main()
