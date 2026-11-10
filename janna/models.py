"""Public Janna model identities with accurate upstream attribution.

Janna Pro 1.1 and Janna Lite 1.1 are independently configurable inference profiles,
not separately trained foundation models. Base model blobs are installed by the
user's local runtime and are never included in Janna distributions.
"""
from __future__ import annotations

import json
from pathlib import Path

MODEL_TAG = 'janna-pro-1.0:latest'
NAME = 'Janna Pro 1.1'
UPSTREAM = 'bonsai-2:27b'
LITE_TAG = 'janna-lite-1.0:latest'
LITE_NAME = 'Janna Lite 1.1'
LITE_UPSTREAM = 'bonsai-2:9b'
# Older Janna installs used this tag. Leave it usable; don't delete user models.
LEGACY_LITE_TAG = 'janna-pro-1.0-lite:latest'
MODEL_DIR = Path(__file__).resolve().parents[1] / 'models'
MANIFEST = MODEL_DIR / 'janna-pro-1.0.json'
REI_MANIFEST = MODEL_DIR / 'janna-lite-1.0.json'


def canonical_tag(model_id: str) -> str:
    raw = str(model_id or '').strip().lower()
    return raw if ':' in raw else raw + ':latest'


def is_pro(model_id: str) -> bool:
    return canonical_tag(model_id) == MODEL_TAG


def is_lite(model_id: str) -> bool:
    return canonical_tag(model_id) == LITE_TAG


def is_pro_lite(model_id: str) -> bool:
    """Legacy model accepted for existing installations; not a new product name."""
    return canonical_tag(model_id) == LEGACY_LITE_TAG


# Names for weights that are installed beside Janna Pro and Janna Lite. These are not Janna Pro or Janna Lite.
_KNOWN_LABELS = {
    'bonsai-2:27b': 'Bonsai 27B',
    'bonsai-2:9b': 'Bonsai 9B',
    'bonsai2-local:latest': 'Bonsai local',
}


def display_name(model_id: str) -> str:
    if is_pro(model_id):
        return NAME
    if is_lite(model_id):
        return LITE_NAME
    if is_pro_lite(model_id):
        return 'Janna Lite 1.1 (legacy)'
    tag = canonical_tag(model_id)
    if tag in _KNOWN_LABELS:
        return _KNOWN_LABELS[tag]
    base = tag[:-7] if tag.endswith(':latest') else tag
    base = ' '.join(base.replace(':', ' ').replace('_', ' ').replace('-', ' ').split())
    return (base[:1].upper() + base[1:]) if base else 'Installed model'


def model_note(model_id: str) -> str:
    """One line for the model menu. Base weights are not described as Janna Pro or Janna Lite."""
    tag = canonical_tag(model_id)
    if is_pro(model_id):
        return 'Full profile · recommended'
    if is_lite(model_id):
        return 'Lightweight profile'
    if is_pro_lite(model_id):
        return 'Older lightweight profile'
    if tag == canonical_tag(UPSTREAM):
        return 'Base weights · not the Janna Pro profile'
    if tag == canonical_tag(LITE_UPSTREAM):
        return 'Base weights · not the Janna Lite profile'
    return 'Installed on this PC'


def catalog(installed: list[str]) -> list[dict]:
    rows = []
    for raw in installed:
        if not isinstance(raw, str) or not raw:
            continue
        branded = is_pro(raw) or is_lite(raw) or is_pro_lite(raw)
        rows.append({'id': raw, 'label': display_name(raw), 'note': model_note(raw),
                     'pro': is_pro(raw), 'lite': is_lite(raw),
                     'model_class': 'Janna engineering profile' if branded else 'Installed local model'})
    rows.sort(key=lambda item: (
        0 if item['pro'] else 1 if item['lite'] else 2 if is_pro_lite(item['id']) else 3,
        item['label'].casefold()))
    counts: dict[str, int] = {}
    for row in rows:
        counts[row['label']] = counts.get(row['label'], 0) + 1
    for row in rows:
        if counts[row['label']] > 1:
            row['label'] = row['label'] + ' · ' + row['id']
    return rows


def default_model(installed: list[str]) -> str:
    names = [row['id'] for row in catalog(installed)]
    return next((m for m in names if is_pro(m)),
                next((m for m in names if is_lite(m)),
                     next((m for m in names if is_pro_lite(m)),
                          next((m for m in names if m == UPSTREAM), names[0] if names else ''))))


def manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding='utf-8'))


def lite_manifest() -> dict:
    return json.loads(REI_MANIFEST.read_text(encoding='utf-8'))


def state(installed: list[str]) -> dict:
    return {'name': NAME, 'version': '1.1',
            'installed': any(is_pro(x) for x in installed),
            'base_installed': UPSTREAM in installed,
            'installed_lite': any(is_lite(x) for x in installed),
            'rei_base_installed': LITE_UPSTREAM in installed,
            'installed_lite': any(is_pro_lite(x) for x in installed),
            'lite': lite_manifest(), 'registration_script': 'scripts/Register-Janna-Pro-1.0.ps1',
            'profile': manifest()}


def _register(tag: str, upstream: str, filename: str, label: str, installed: list[str], *, runner=None, engine=None) -> dict:
    import shutil
    import subprocess
    if any(canonical_tag(x) == canonical_tag(tag) for x in installed):
        return {'registered': True, 'already_installed': True, 'model': label}
    if upstream not in installed:
        raise ValueError(f'{label} base weights are missing. Use the guided model setup in Janna.')
    exe = engine or shutil.which('ollama')
    if not exe:
        raise ValueError('The local inference engine is not installed')
    modelfile = MODEL_DIR / filename
    if not modelfile.is_file():
        raise ValueError(f'{label} profile is missing from this installation')
    result = (runner or subprocess.run)([exe, 'create', tag.split(':')[0], '-f', str(modelfile)],
                                        capture_output=True, text=True, timeout=120, shell=False)
    if result.returncode:
        raise RuntimeError(f'{label} setup failed. Original models were not modified.')
    return {'registered': True, 'already_installed': False, 'model': label}


def register_janna_pro(installed: list[str], *, runner=None, engine=None) -> dict:
    return _register(MODEL_TAG, UPSTREAM, 'Janna-Pro-1.0.Modelfile', NAME, installed, runner=runner, engine=engine)


def register_lite(installed: list[str], *, runner=None, engine=None) -> dict:
    return _register(LITE_TAG, LITE_UPSTREAM, 'Janna-Lite-1.0.Modelfile', LITE_NAME, installed, runner=runner, engine=engine)
