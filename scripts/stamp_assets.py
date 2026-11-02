"""Stamp assets/app.{js,css} cache-busters with a hash of their own contents.

Changing a shared asset without changing its ?v= string leaves every browser
that visited before running the previous build for as long as it keeps the
file: the page and its data refresh around stale code, so the board looks
current and behaves old. Deriving the stamp from the bytes makes that
impossible to forget. Idempotent -- a run that changes nothing rewrites
nothing, so it is safe inside the minute chain.
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ("assets/app.js", "assets/app.css")


def stamp():
    h = hashlib.sha256()
    for rel in ASSETS:
        h.update((ROOT / rel).read_bytes())
    return h.hexdigest()[:10]


def main():
    want = stamp()
    check = "--check" in sys.argv
    changed = []
    for page in sorted(ROOT.glob("*.html")):
        src = page.read_text()
        out = re.sub(r"(assets/app\.(?:js|css))\?v=[^\"']*", rf"\1?v={want}", src)
        if out != src:
            if not check:
                page.write_text(out)
            changed.append(page.name)
    if check and changed:
        print(f"STALE asset stamp: {', '.join(changed)} do not carry {want}.")
        print("Run: python3 scripts/stamp_assets.py")
        return 1
    print(f"asset stamp {want}" + (f" -> rewrote {', '.join(changed)}" if changed else " (already current)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
