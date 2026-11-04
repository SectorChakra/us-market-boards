/* Shared rendering helpers for the US boards. Forked from the Nifty version
   and localised in four places only - currency, number locale, the quote link
   and the status timezone - so the tile, day-range, index-card and movers
   components stay recognisably the same components.

   The fork is deliberate rather than a shared file: the two differ in every
   one of those four, and a runtime market flag threaded through every helper
   would be more fragile than two small files that each read straightforwardly. */

const POLL_MS = 30000;
const STALE_MS = 20 * 60 * 1000; // flag if the data file hasn't updated in 20 min

/* Per-stock colour scale (shared by both boards so a colour means the
   same % move everywhere). */
function bucket(pct){
  if(pct === null || pct === undefined) return 'b-na';
  if(pct >= 3) return 'b-strong-gain';
  if(pct >= 2) return 'b-gain-3';
  if(pct >= 1) return 'b-gain-2';
  if(pct > 0)  return 'b-gain-1';
  if(pct === 0) return 'b-flat';
  if(pct > -1) return 'b-loss-1';
  if(pct > -2) return 'b-loss-2';
  return 'b-strong-loss';
}

/* Sector averages are far smaller in magnitude than single-stock moves, so
   they get their own finer scale. Same palette, different thresholds. */
function sectorBucket(pct){
  if(pct === null || pct === undefined) return 'b-na';
  if(pct >= 1.5)  return 'b-strong-gain';
  if(pct >= 0.75) return 'b-gain-3';
  if(pct >= 0.25) return 'b-gain-2';
  if(pct > 0)     return 'b-gain-1';
  if(pct === 0)   return 'b-flat';
  if(pct > -0.25) return 'b-loss-1';
  if(pct > -0.75) return 'b-loss-2';
  if(pct > -1.5)  return 'b-loss-3';
  return 'b-strong-loss';
}

function fmtPrice(p){
  return p === null || p === undefined ? 'N/A' : '$' + p.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function fmtPct(p){
  if(p === null || p === undefined) return '—';
  const sign = p >= 0 ? '+' : '';
  return sign + p.toFixed(2) + '%';
}
/* Adaptive precision. The Indian boards show index levels in the thousands,
   where whole numbers are right. Here the same slot carries a sector FUND:
   XLU trades near $39.83 with a day range of about 20 cents, so rounding to
   whole numbers printed "40 — 40" and the bar looked broken. Below $1,000 the
   figure keeps two decimals; above it, none. */
function fmtCompact(p){
  if(p === null || p === undefined) return '—';
  return p.toLocaleString('en-US', p < 1000
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 });
}
/* Size, in the user's requested $ xx.x Mn/Bn/Tr form.

   One decimal throughout, so a column of tiles stays the same width whether
   it reads 15.9 Bn or 5.1 Tr. */
function fmtCap(v){
  if(v === null || v === undefined || !isFinite(v)) return '';
  const a = Math.abs(v);
  if(a >= 1e12) return '$ ' + (v / 1e12).toFixed(1) + ' Tr';
  if(a >= 1e9)  return '$ ' + (v / 1e9).toFixed(1) + ' Bn';
  if(a >= 1e6)  return '$ ' + (v / 1e6).toFixed(1) + ' Mn';
  return '$ ' + Math.round(v).toLocaleString('en-US');
}

/* Market cap for a stock, net assets for a fund - two different quantities,
   kept apart on purpose.

   A stock's cap is rebuilt here as shares x the LIVE price rather than read
   from the file, so it moves with the % change printed beside it. The share
   count comes from caps.json and changes on buybacks, not on the minute.

   A fund has no market cap. Yahoo returns null for every ETF, so the figure
   shown is net assets (AUM) exactly as published - flat, never scaled by the
   day's move, because an ETF's share count changes with creations and
   redemptions and scaling it would invent a number. The tooltip says which
   of the two a tile is showing. */
let CAPS = { shares: {}, netAssets: {} };
function sizeOf(r){
  const sh = CAPS.shares[r.ticker];
  if(sh && r.price) return { value: sh * r.price, label: 'Market cap' };
  const na = CAPS.netAssets[r.ticker];
  if(na) return { value: na, label: 'Net assets' };
  return null;
}

/* caps.json is rebuilt daily, so it is fetched once rather than polled. A
   failure must not cost us the board: the tiles simply render without the
   figure, and the next daily load picks it up. */
async function loadCaps(){
  try{
    const resp = await fetch('data/caps.json?t=' + Date.now(), { cache: 'no-store' });
    if(!resp.ok) throw new Error('HTTP ' + resp.status);
    const d = await resp.json();
    CAPS = { shares: d.shares || {}, netAssets: d.netAssets || {} };
  }catch(e){
    console.warn('caps.json unavailable - tiles will render without size', e);
  }
}

/* Which indices the board can actually list the members of, and who they are.

   Four of the eight can be drilled into: the S&P 500 because the board prices
   all 503, and the S&P 100, Dow 30 and Nasdaq-100 because they are small and
   sit almost entirely inside that set (the fifteen Nasdaq-100 names that do
   not - ASML, ARM, PDD and the rest - are fetched alongside it).

   The other four cannot, and say so rather than showing part of themselves.
   The Russell 1000, Russell 2000, S&P SmallCap 600 and Nasdaq Composite run
   to roughly 1,000 / 2,000 / 600 / 3,300 names that this board does not
   price. A list of whichever handful happened to overlap would look like the
   index and would not be it. */
let MEMBERS = {};
async function loadMembers(){
  try{
    const resp = await fetch('data/index_members.json?t=' + Date.now(), { cache: 'no-store' });
    if(!resp.ok) throw new Error('HTTP ' + resp.status);
    MEMBERS = (await resp.json()).members || {};
  }catch(e){
    console.warn('index_members.json unavailable - no drill-down', e);
  }
}

function quoteUrl(ticker){
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
}
function slug(s){
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function dayRangeBar(r){
  if(r.dayLow === null || r.dayLow === undefined || r.dayHigh === null || r.dayHigh === undefined || r.dayHigh <= r.dayLow || r.price === null){
    return '';
  }
  let pos = (r.price - r.dayLow) / (r.dayHigh - r.dayLow) * 100;
  pos = Math.min(100, Math.max(0, pos));
  return `
    <div class="day-range">
      <div class="track"><div class="dot" style="left:${pos.toFixed(1)}%"></div></div>
      <div class="labels"><span>${fmtCompact(r.dayLow)}</span><span>${fmtCompact(r.dayHigh)}</span></div>
    </div>
  `;
}

/* A name trading ex a corporate action. The raw print is an artefact - the
   share count or the company changed overnight - so the tile is LABELLED
   rather than left to read as a catastrophic loss. A split or bonus has an
   exact ratio from its announced terms, so the % shown is the real
   like-for-like move; a demerger has no such ratio, so it reads NA. */
function caTag(r){
  if(!r.ca) return '';
  const what = /split/i.test(r.ca.what) ? 'ex-split' : 'ex-spin-off';
  return `<div class="ca-tag na">${what}</div>`;
}
function caTitle(r){
  if(!r.ca) return '';
  return ` · ${r.ca.what} (${r.ca.date}). Today's raw print ${fmtPct(r.ca.rawPct)} spans the `
    + 'event, so it is withheld rather than averaged into the sector. Tomorrow the figure is '
    + 'right on its own.';
}

/* One tile: name, price, % change, day-range bar, click through to the quote.
   Used for both stocks and ETFs - an ETF row has the same shape, so the two
   kinds of block are rendered by the same component rather than by two that
   could drift. */
function tileHtml(r){
  const pctText = (r.ca && !r.ca.adjusted) ? 'NA' : fmtPct(r.pct);
  const size = sizeOf(r);
  return `
    <a class="tile ${bucket(r.pct)}${r.ca ? ' ex-ca' : ''}" href="${quoteUrl(r.ticker)}" target="_blank" rel="noopener noreferrer" title="${r.full ? r.full + ' · ' : ''}${size ? size.label + ' ' + fmtCap(size.value) + ' · ' : ''}Day range: ${fmtPrice(r.dayLow)} – ${fmtPrice(r.dayHigh)}${caTitle(r)} · View on Yahoo Finance">
      <div class="name-row">
        <div class="name">${r.name}${r.ca ? '<span class="adj-star" title="corporate action today — see the note below the board">*</span>' : ''}</div>
        ${size ? `<div class="cap" title="${size.label}: ${fmtCap(size.value)}">${fmtCap(size.value)}</div>` : ''}
      </div>
      ${r.full && r.full !== r.name ? `<div class="full">${r.full}</div>` : ''}
      <div class="figures">
        <div class="price">${fmtPrice(r.price)}</div>
        <div class="pct">${pctText}</div>
      </div>
      ${caTag(r)}
      ${dayRangeBar(r)}
    </a>
  `;
}

/* One index card: name, level, change, day range, then the two readouts that
   say what is happening when the cash session is NOT the whole story.

   FUT is the front-month future, quoted against its OWN previous settle -
   which is what "futures are up X" means wherever it is quoted. Measuring it
   against the cash close instead would compare two prices struck at different
   moments and produce a confident, meaningless number.

   PRE/POST is an ETF proxy, and is labelled with that proxy on the row. A cash
   index has no extended-hours value at all - there is nothing to compute one
   from - so the honest thing is to show the fund that does trade and name it,
   never to imply the index itself printed. It appears only when the newest bar
   really is outside the session; during the cash session the futures row is
   the live overnight reference and this one is absent rather than stale. */
function indexCardHtml(key, displayName, idx, fut, ext, size, exact){
  if(!idx || idx.price === undefined || idx.price === null){
    return `<div class="index-card"><div class="index-card-head"><span class="idx-name">${displayName}</span></div><span style="color:var(--text-dim);font-size:12px;">No data</span></div>`;
  }
  const num = (v,d=2) => v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
  const up = idx.pct >= 0;
  const n = (MEMBERS[key] || []).length;
  const countText = size ? `${exact ? '' : '~'}${size.toLocaleString('en-US')}` : '';
  /* The day's move in index POINTS, opposite the name. The % beside the level
     answers "how big a move is this"; the points answer "how far has it
     actually travelled", which is the number quoted when people talk about
     the Dow. Both are the same move, so they always carry the same sign and
     the same colour. */
  const ptsHtml = (idx.pts === null || idx.pts === undefined) ? ''
    : `<span class="idx-pts ${up ? 'up':'down'}" title="Change today in index points">`
      + `${up?'+':'\u2212'}${Math.abs(idx.pts).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`;
  const headHtml = `
    <div class="index-card-head">
      <div class="idx-title">
        <span class="idx-name">${displayName}</span>
        ${countText ? `<span class="idx-count">${countText}</span>` : ''}
        ${ptsHtml}
      </div>
      <span class="idx-figures">
        <span class="idx-price">${num(idx.price)}</span>
        <span class="idx-delta ${up ? 'up':'down'}">${up?'+':''}${idx.pct.toFixed(2)}%</span>
      </span>
    </div>`;

  let rangeHtml = '';
  if(idx.dayLow != null && idx.dayHigh != null && idx.dayHigh > idx.dayLow){
    let pos = (idx.price - idx.dayLow) / (idx.dayHigh - idx.dayLow);
    pos = Math.min(0.94, Math.max(0.06, pos));
    const leftExpr = `calc(34px + (100% - 68px) * ${pos.toFixed(4)})`;
    rangeHtml = `
      <div class="range-visual">
        <div class="track-line"></div>
        <div class="end-pill low">${idx.dayLow.toLocaleString('en-US',{maximumFractionDigits:0})}</div>
        <div class="end-pill high">${idx.dayHigh.toLocaleString('en-US',{maximumFractionDigits:0})}</div>
        <div class="cur-stem" style="left:${leftExpr}"></div>
        <div class="cur-dot" style="left:${leftExpr}"></div>
      </div>`;
  }

  /* `ref` is the price this row's % is measured against - the future's own
     previous settle, or the proxy ETF's regular close. The points are derived
     from that same reference, so the % and the points on a row can never
     disagree about either the size or the direction of the move. Without a
     reference there is nothing honest to subtract, so the slot is omitted. */
  const sub = (label, tag, price, pct, title, ref) => {
    const u = pct >= 0;
    const ptsCell = (ref == null) ? '<span class="s-pts"></span>'
      : `<span class="s-pts ${u?'up':'down'}">`
        + `${u?'+':'\u2212'}${num(Math.abs(price - ref))}</span>`;
    return `<div class="idx-sub" title="${title}">
      <span class="s-lbl">${label}</span>
      <span class="s-tag">${tag}</span>
      <span class="s-px">${num(price)}</span>
      <span class="s-pc ${u?'up':'down'}">${u?'+':''}${pct.toFixed(2)}%</span>
      ${ptsCell}
    </div>`;
  };

  let extras = '';
  if(fut && fut.price != null){
    extras += sub('FUT', fut.ticker, fut.price, fut.pct,
      `${fut.name} — against its own previous settle ${num(fut.prevClose)}`,
      fut.prevClose);
  }
  if(ext && ext.price != null){
    const when = ext.asOf ? new Date(ext.asOf).toLocaleTimeString('en-US',
      {timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'}) : '';
    extras += sub(ext.phase === 'pre' ? 'PRE' : 'POST', ext.proxy, ext.price, ext.pct,
      `${ext.proxy} extended-hours print at ${when} ET, against its regular close `
      + `${num(ext.refClose)}. The index itself does not trade outside the session; `
      + `this is the ETF that tracks it.`, ext.refClose);
  }
  if(extras) extras = `<div class="idx-subs">${extras}</div>`;

  /* Drillable cards are real buttons, so they are reachable by keyboard and
     announce themselves as doing something. The rest are plain divs: a card
     that looks clickable and is not is worse than one that never offered. */
  if(n){
    return `<button type="button" class="index-card drillable" data-index="${key}"
              title="Show the ${n} members of ${displayName} on the board">${headHtml}${rangeHtml}${extras}
              <span class="idx-drill">${n} members &rsaquo;</span></button>`;
  }
  return `<div class="index-card" title="${displayName} has ${countText || 'more'} constituents, which this board does not price — the level is live, but there is no member list to open.">${headHtml}${rangeHtml}${extras}
            <span class="idx-drill none">members not tracked</span></div>`;
}

function moversList(items, field){
  return items.map(r => `
    <div class="mover-row">
      <div class="mover-top">
        <span class="m-name">${r.name}${r.full && r.full !== r.name ? `<span class="m-full">${r.full}</span>` : ''}</span>
        <span class="m-price">${fmtPrice(r.price)}</span>
        <span class="m-pct">${fmtPct(r[field])}</span>
      </div>
      ${dayRangeBar(r)}
    </div>
  `).join('');
}

function renderLegend(elId){
  const stops = [
    ['b-strong-loss','≤ -2%'], ['b-loss-2','-1.5%'], ['b-loss-1','-0.5%'],
    ['b-flat','0%'], ['b-gain-1','+0.5%'], ['b-gain-2','+1.5%'], ['b-strong-gain','≥ +3%'],
  ];
  const el = document.getElementById(elId);
  if(el) el.innerHTML = stops.map(([cls,lbl]) =>
    `<div class="chip ${cls}"></div><span class="lbl">${lbl}</span>`
  ).join('');
}

function setStatus(text, stale){
  const t = document.getElementById('statusText');
  const tag = document.getElementById('statusTag');
  if(t) t.textContent = text;
  if(tag) tag.classList.toggle('stale', !!stale);
}

/* Poll `dataFile` every POLL_MS and hand the parsed payload to `renderFn`. */
function startPolling(dataFile, renderFn){
  async function poll(){
    try{
      const resp = await fetch(dataFile + '?t=' + Date.now(), { cache: 'no-store' });
      if(!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      renderFn(data);

      const generated = new Date(data.generatedAt);
      const ageMs = Date.now() - generated.getTime();
      const ageMin = Math.round(ageMs / 60000);
      const timeStr = generated.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const stale = ageMs > STALE_MS;
      setStatus(`Updated ${timeStr} ET · ${ageMin < 1 ? 'just now' : ageMin + 'm ago'}${stale ? ' (stale)' : ''}`, stale);
    }catch(e){
      setStatus(`Could not reach ${dataFile} — retrying…`, true);
    }
  }
  poll();
  setInterval(poll, POLL_MS);
}

/* Floating "back to top" button. Created from here so both boards get it and
   neither can drift. Appears once you are past the first screenful, sits clear
   of the left-aligned sector headings, and honours reduced-motion. */
function initBackToTop(showAfter = 400){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'to-top';
  btn.setAttribute('aria-label', 'Back to top');
  btn.title = 'Back to top';
  btn.innerHTML = '<span aria-hidden="true">&#8593;</span> Top';
  document.body.appendChild(btn);

  btn.addEventListener('click', () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });

  let shown = null;
  function sync(){
    const show = window.scrollY > showAfter;
    if(show !== shown){
      shown = show;
      btn.classList.toggle('visible', show);
    }
  }
  sync();
  window.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync, { passive: true });

  // The board renders after its data arrives. If the browser restored a scroll
  // position on reload, that happens while the document is still short and no
  // scroll event follows - so re-check whenever the page height changes.
  if(typeof ResizeObserver !== 'undefined'){
    new ResizeObserver(sync).observe(document.body);
  }
}

/* Shown only while a name is actually trading ex a corporate action, so the
   board carries no standing caveat on the ~364 days a year when none is. */
function renderCaNote(rows){
  const el = document.getElementById('caNote');
  if(!el) return;
  const hits = (rows || []).filter(r => r && r.ca);
  if(!hits.length){ el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = '<strong>Trading across a corporate action today.</strong> '
    + hits.map(r => `<strong>${r.name}</strong> — ${r.ca.what} (${r.ca.date}), `
        + `raw print ${fmtPct(r.ca.rawPct)}, shown as <strong>NA</strong> and left out of its `
        + `sector average.`).join(' ')
    + ' The raw figure spans the event rather than measuring a move, and this session is the only '
    + 'one affected — tomorrow the name is right on its own. Nothing is rewritten to a guess: the '
    + 'figure is withheld, not adjusted, because only the historical series has a ratio worth '
    + 'dividing out. Large moves that are <em>not</em> backed by a corporate event are never '
    + 'touched at all.';
}

