"""Small, clearly attributed Janna project facts and evidence-status handling.

Unlike prompt-only 'memory', these are explicit user-provided project facts.
They are NOT a substitute for current repository inspection.
"""
from __future__ import annotations
import re

KNOWN_PROJECTS = {
    "janna": "Janna AI is an AI developer application by Jepong Devxyz. Janna Pro 1.1 and Janna Lite 1.1 are its full and lightweight local model profiles; this is a specialized configuration, not a newly pre-trained foundation model.",
    "janna lite": "Janna Lite 1.1 is Janna's lower-memory 9B engineering profile, configured for 8 GB GPUs. Like Janna Pro, it uses separately installed upstream weights and is not newly retrained.",
    "janna pro": "Janna Pro 1.1 is the named local engineering model profile for Janna AI. It reuses separately licensed base-model weights and does not imply weights were retrained.",
}
_NO_SEARCH_CLAIM = re.compile(r"(?i)(?:i\s+(?:do\s+not|don't|can(?:not|'t)|have\s+no)\s+(?:have\s+)?(?:a\s+)?(?:live\s+)?(?:web\s+)?(?:search\s+tool|internet\s+access|search\s+access|access\s+to\s+the\s+internet)|i\s+can\s+only\s+(?:use|work\s+with)\s+(?:my\s+)?training)")


def project_facts(prompt: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9 ]", " ", str(prompt)).lower()
    text = re.sub(r"\s+", " ", text)
    found = []
    if re.search(r"\bjanna\s+pro\b",text):
        found.append(KNOWN_PROJECTS["janna pro"])
    elif re.search(r"\bjanna\s+lite\b",text):
        found.append(KNOWN_PROJECTS["janna lite"])
    elif re.search(r"\bjanna\b",text):
        found.append(KNOWN_PROJECTS["janna"])
    return ("Creator-provided background (NOT live validation):\n" + "\n".join(found)) if found else ""


def research_correction(reply: str, packet: dict | None) -> str | None:
    """Do not rewrite the model reply. Surface an independently verifiable UI notice."""
    denied_service = re.search(r"(?:no|don't have|do not have|lack|unavailable|not available)[^.\n]{0,80}(?:github|reddit)|(?:github|reddit)[^.\n]{0,80}(?:no access|unavailable|not available|not granted)", reply, re.I)
    if packet and packet.get('kind')=='github_repository' and packet.get('results') and not (_NO_SEARCH_CLAIM.search(reply) or denied_service):
        return 'Partial source review. Builds, tests and current PR status were not checked; documentation may describe an older state.'
    if not packet or not (_NO_SEARCH_CLAIM.search(reply) or denied_service):
        return None
    freshness=packet.get("freshness")
    count=len(packet.get("results") or [])
    if freshness in ('live_source_files', 'live_comments') and count:
        return f"Janna's read service obtained {count} source references for this answer. The model's access denial conflicts with the recorded reads. Review the references; retrieved text does not establish runtime correctness or representative community sentiment."
    if freshness=="live_leads" and count:
        return f"The local research service did retrieve {count} source leads for this answer. The model's statement that no search is available was inaccurate; review the references below. Search results are leads, not verified facts."
    if packet.get("searched"):
        return "Janna attempted live research, but did not obtain verifiable current sources. The answer should not imply that no research tool exists; this request had an unavailable or limited source connection."
    return None
