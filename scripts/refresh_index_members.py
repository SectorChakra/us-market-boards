"""Constituent lists for the headline indices whose members the board can show.

Only four indices are listed here, and the omissions are the point. The board
prices 503 S&P 500 names plus 112 funds. The S&P 100, the Dow 30 and the
Nasdaq-100 are small, stable and almost entirely inside that set, so their
members can be shown honestly. The Russell 1000, the Russell 2000, the Nasdaq
Composite and the S&P SmallCap 600 are 1,000 / 2,000 / ~3,300 / 600 names the
board does not fetch at all -- so they get a level and no drill-down, rather
than a partial list that would read as the whole index.

Each list is checked against the count the index is DEFINED by (the Dow has
thirty members because it has thirty members) and the run aborts on a
mismatch, so a Wikipedia edit that breaks a table fails loudly instead of
silently publishing a short index.
"""
import argparse
import json
import pathlib
import re
import sys

import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from us_market_core import SPX_ALL, now_et  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "index_members.json"
API = "https://en.wikipedia.org/w/api.php"
UA = {"User-Agent": "us-market-boards/1.0 (https://github.com/SectorChakra/us-market-boards)"}

# key -> (wikipedia page, row pattern capturing (ticker, company), companies)
#
# Each pattern captures the COMPANY as well as the ticker, and the guard below
# counts companies, not tickers. That is not fussiness: the first version of
# this file matched tickers alone, missed Berkshire because its row carries a
# trailing HTML comment, and still totalled exactly 100 - the expected number -
# so a count-only check passed an index with the wrong members in it. Counting
# something the pattern had to understand makes that impossible.
#
# Ticker count exceeds company count wherever a company has two listed share
# classes: Alphabet is in all three of these indices as both GOOG and GOOGL.
SOURCES = {
    "sp100": ("S&P 100",
              r"^\|\s*([A-Z]{1,5}(?:\.[A-Z])?)\s*(?:<!--.*?-->)?\s*\n\|\s*\[\[([^\]|]+)",
              100),
    "nasdaq100": ("List of NASDAQ-100 companies",
                  r"^\|\s*([A-Z]{1,5}(?:\.[A-Z])?)\s*\|\|\s*\[\[([^\]|]+)",
                  100),
    "dow": ("List of Dow Jones Industrial Average companies",
            r"!scope=\"row\"\|\s*\[\[([^\]|]+)[^\n]*\n(?:[^\n]*\n)*?\|\s*\{\{(?:NYSE|NASDAQ) link\|([A-Z]{1,5}(?:\.[A-Z])?)\}\}",
            30),
}

# The Dow pattern captures (company, ticker); the other two capture
# (ticker, company).
SWAPPED = {"dow"}


def wikitext(page):
    r = requests.get(API, headers=UA, timeout=30, params={
        "action": "parse", "page": page, "prop": "wikitext",
        "format": "json", "formatversion": "2"})
    r.raise_for_status()
    return r.json()["parse"]["wikitext"]


def members(key):
    page, pattern, expect = SOURCES[key]
    pairs = re.findall(pattern, wikitext(page), re.M | re.S)
    if key in SWAPPED:
        pairs = [(t, c) for c, t in pairs]
    tickers = sorted({t for t, _ in pairs})
    companies = {c.strip() for _, c in pairs}
    if len(companies) != expect:
        raise SystemExit(
            f"{key}: parsed {len(companies)} companies ({len(tickers)} tickers) "
            f"from '{page}', expected {expect}. The table's markup has probably "
            "changed - fix the pattern rather than publishing a wrong index.")
    # Yahoo spells class shares with a hyphen; Wikipedia uses a dot.
    return [t.replace(".", "-") for t in tickers], len(companies)


def build():
    out = {"sp500": sorted(SPX_ALL)}
    extra = set()
    spx = set(SPX_ALL)
    for key in SOURCES:
        out[key], ncos = members(key)
        missing = [t for t in out[key] if t not in spx]
        extra.update(missing)
        print(f"{key:10} {len(out[key]):>4} tickers / {ncos} companies"
              + (f", {len(missing)} outside the S&P 500: {', '.join(missing)}" if missing else ""))

    payload = {"generatedAt": now_et().isoformat(timespec="seconds"), "members": out}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":"), sort_keys=True))
    print(f"-> {OUT.name}")
    if extra:
        print(f"\nNeeds pricing but is not an S&P 500 name ({len(extra)}): "
              f"{', '.join(sorted(extra))}")
    return 0


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    return build()


if __name__ == "__main__":
    sys.exit(main())
