"""Market capitalisation (equities) and net assets (funds) for every tile.

Two quantities, deliberately kept apart:

* An EQUITY has a market cap. What is stored is not the cap but the implied
  share count -- Yahoo's cap divided by the price it was struck at -- so the
  board can multiply by the LIVE price and have the figure move with the tile
  it sits on. Storing the cap itself would freeze it at the daily fetch while
  the price beside it ticked, which reads as an error.

  The share count is implied rather than taken from `sharesOutstanding`
  because of dual-class names: Yahoo's `marketCap` already spans every class
  (GOOGL comes back at 12.29bn shares, A+B+C), while `sharesOutstanding` is
  the quoted class alone and would under-count Alphabet by roughly a third.

* A FUND has no market cap -- Yahoo returns null for every ETF. The honest
  counterpart is net assets (AUM), which is stored flat and NOT scaled by
  price: an ETF's share count moves with creations and redemptions, so
  scaling AUM by the day's price move would invent a number.

Run daily. Share counts change on buybacks and issuance, not on the minute.
"""
import argparse
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from us_market_core import ETF_ALL, SPX_ALL, now_et  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "caps.json"
QUOTE_URL = "https://query2.finance.yahoo.com/v7/finance/quote"
FIELDS = "marketCap,netAssets,regularMarketPrice,quoteType"
BATCH = 100


def _client():
    """yfinance's session, borrowed for the cookie+crumb v7/quote needs.

    Called bare, v7/quote answers 429 -- it is the same gate that makes the
    options endpoint 401. yfinance already solves it, so the crumb is taken
    from there rather than reimplemented.
    """
    from yfinance import data as ydata

    return ydata.YfData()


def fetch(symbols, tries=3):
    yd = _client()
    out = {}
    missing = []
    for i in range(0, len(symbols), BATCH):
        chunk = symbols[i:i + BATCH]
        for attempt in range(tries):
            try:
                r = yd.get_raw_json(QUOTE_URL, params={"symbols": ",".join(chunk), "fields": FIELDS})
                for q in r["quoteResponse"]["result"]:
                    out[q["symbol"]] = q
                break
            except Exception as exc:
                if attempt == tries - 1:
                    print(f"  batch {i // BATCH}: {type(exc).__name__}: {str(exc)[:120]}")
                    missing.extend(chunk)
                else:
                    time.sleep(1.5 * (attempt + 1))
        time.sleep(0.2)
    return out, missing


def build():
    symbols = sorted(set(SPX_ALL) | set(ETF_ALL))
    quotes, failed = fetch(symbols)

    equities, funds, nocap = {}, {}, []
    for sym in symbols:
        q = quotes.get(sym)
        if not q:
            if sym not in failed:
                failed.append(sym)
            continue
        cap, px = q.get("marketCap"), q.get("regularMarketPrice")
        if cap and px:
            equities[sym] = round(cap / px)
            continue
        net = q.get("netAssets") or q.get("totalAssets")
        if net:
            funds[sym] = float(net)
        else:
            nocap.append(sym)

    payload = {
        "generatedAt": now_et().isoformat(timespec="seconds"),
        # Implied share counts: multiply by the live price for the cap.
        "shares": equities,
        # Net assets, as published. Flat -- never scaled by price.
        "netAssets": funds,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":"), sort_keys=True))

    print(f"{len(equities)} equities, {len(funds)} funds -> {OUT.name}")
    if nocap:
        print(f"  no cap and no net assets ({len(nocap)}): {', '.join(nocap[:12])}")
    if failed:
        print(f"  FETCH FAILED ({len(failed)}): {', '.join(sorted(set(failed))[:12])}")
    # A total wipe-out means the endpoint is refusing us, not that the
    # companies have no value -- say so loudly rather than publishing an
    # empty file over a good one.
    if not equities:
        print("REFUSING to write an empty cap set", file=sys.stderr)
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.parse_args()
    return build()


if __name__ == "__main__":
    sys.exit(main())
