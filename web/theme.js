/* Restore appearance before painting; keep supported system chrome in sync. */
(() => {
  const KEY = 'janna-appearance';
  const meta = (name, value) => {
    const tag = document.querySelector(`meta[name="${name}"]`);
    if (tag) tag.setAttribute('content', value);
  };
  const paint = (color, scheme) => {
    document.body.dataset.scheme = scheme;
    document.documentElement.style.backgroundColor = color;
    document.documentElement.style.colorScheme = scheme;
    document.body.style.colorScheme = scheme;
    meta('theme-color', color);
    meta('color-scheme', scheme);
  };
  const valid = (saved) => saved
    && /^[a-z]{2,16}$/.test(saved.theme)
    && /^#[\da-f]{6}$/i.test(saved.color)
    && (saved.scheme === 'light' || saved.scheme === 'dark');

  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (valid(saved)) {
      document.body.dataset.theme = saved.theme;
      paint(saved.color, saved.scheme);
    } else if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) {
      // No saved choice: follow the device (Grok's System default) so a dark
      // phone paints dark before the app boots instead of flashing light.
      document.body.dataset.theme = 'dark';
      paint('#161618', 'dark');
    }
  } catch {
    /* Appearance storage is optional, including private browsing. */
  }

  window.syncPhoneChrome = () => {
    const color = getComputedStyle(document.body).getPropertyValue('--paper').trim();
    if (!/^#[\da-f]{6}$/i.test(color)) return;
    const rgb = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
    const scheme = (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) < 140 ? 'dark' : 'light';
    paint(color, scheme);
    try {
      localStorage.setItem(KEY, JSON.stringify({ theme: document.body.dataset.theme, color, scheme }));
    } catch {
      /* Appearance storage is optional. */
    }
  };
  window.syncPhoneChrome();
})();
