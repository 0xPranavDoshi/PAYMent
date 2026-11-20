import { TOKENS, tokensCss } from "@copayme/shared";
import { TWEET_CARD_CSS } from "@copayme/tweet-card";

/**
 * coPAYMe's look (style D): warm paper, thick black outlines and solid offset shadows. It is always
 * light, whatever X's own theme is. All of it comes from the shared tokens, so components just use
 * var(--line) and var(--shadow). Everything lives in shadow roots, so X's styles cannot touch it and
 * ours cannot leak out.
 */
export const TOKENS_CSS = `
  ${tokensCss(":host", TOKENS)}
  :host {
    --font: "Archivo", "Helvetica Neue", Arial, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
    --pill-bg: var(--surface);
    /* X's light-theme colours for a tweet shown inside the card. */
    --tw-link: #1d9bf0; --tw-bg: #ffffff; --tw-ink: #0f1419; --tw-ink-2: #536471; --tw-line: #eff3f4; --tw-avatar: #cfd9de; --tw-avatar-ink: #536471;
  }
    /* What X paints behind the card, so the ticket's notches read as holes. Set by the extension. */
    --page-bg: #ffffff;
  }
`;

/** The score tile (see ScoreTile in brand.tsx): an outlined square with a band-coloured strip. */
export const TILE_CSS = `
  .tile { position: relative; overflow: hidden; flex: none; display: grid; place-content: center; text-align: center; background: var(--surface); border: 2.5px solid var(--line); border-radius: 10px; color: var(--ink); font-family: var(--font); }
  .tile.sm { width: 46px; height: 46px; }
  .tile.lg { width: 64px; height: 64px; }
  .tile .score { font: 900 18px/1 var(--font); font-variant-numeric: tabular-nums; letter-spacing: -.03em; margin-top: -4px; }
  .tile.lg .score { font-size: 26px; }
  .tile .score.new { font: 700 11px/1 var(--mono); letter-spacing: .06em; }
  .tile .cap { font: 700 8px/1 var(--mono); letter-spacing: .08em; color: var(--ink-2); margin-top: 3px; }
  .tile .strip { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; border-top: 2px solid var(--line); background: var(--ticket); }
  .tile .strip.win { background: var(--win); }
  .tile .strip.amber { background: var(--amber); }
  .tile .strip.loss { background: var(--loss); }
`;

export const BADGE_CSS = `
  ${TOKENS_CSS}
  :host { all: initial; display: inline-flex; vertical-align: middle; margin-left: 4px; }
  /* The meter pill: a rounded outline holding a small bar filled to the score, then the score. */
  .pill {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px;
    height: 20px; padding: 0 7px 0 5px; border: 1.5px solid var(--line); border-radius: 999px; cursor: pointer;
    font: 800 12px/1 var(--font); color: var(--ink); white-space: nowrap; background: var(--surface);
  }
  .pill:active { transform: translateY(1px); }
  .pill:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }
  .meter { position: relative; flex: none; box-sizing: border-box; width: 26px; height: 6px; border: 1.5px solid var(--line); border-radius: 4px; overflow: hidden; }
  .meter::after { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--v); }
  .meter.win::after { background: var(--win); }
  .meter.amber::after { background: var(--amber); }
  .meter.loss::after { background: var(--loss); }
  .num { font: 800 12px/1 var(--font); font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .pill:not(.scored) { padding: 0 8px; border-style: dashed; }
  .pill:not(.scored) .num { font: 700 10px/1 var(--mono); letter-spacing: .06em; color: var(--ink-2); }
  .pill.new .num { letter-spacing: .08em; }
  .pill.scanning { cursor: progress; }
  .pill.scanning .clock { font: 700 10px/1 var(--mono); font-variant-numeric: tabular-nums; color: var(--ink); }
  .pill.failed { border-style: solid; border-color: var(--loss); }
  .pill.failed .num { color: var(--loss); }
  @media (prefers-reduced-motion: reduce) { .pill:active { transform: none; } }
`;

/** The corner card that shows a scan running, and how it ended. */
export const SCAN_CSS = `
  ${TOKENS_CSS}
  :host { all: initial; }
  * { box-sizing: border-box; }
  .scan {
    width: 320px; padding: 14px 16px 16px; border-radius: 14px; font-family: var(--font); font-size: 13px; line-height: 1.4;
    background: var(--card); color: var(--ink); border: 2.5px solid var(--line); box-shadow: 5px 5px 0 var(--shadow);
  }
  .scan.failed { border-color: var(--loss); }
  .head { display: flex; align-items: center; gap: 8px; }
  .head b { font: 800 14px/1.2 var(--font); letter-spacing: -.01em; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mark { width: 16px; height: 16px; color: var(--line); flex: none; display: block; }
  .clock { font: 700 12px/1 var(--mono); font-variant-numeric: tabular-nums; color: var(--ink); }
  .x { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--line); display: grid; place-items: center; color: var(--ink); font: 800 14px/1 var(--font); }
  .x:hover { background: var(--ticket); }
  .x:focus-visible, .again:focus-visible, .stop:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }
  p { margin: 10px 0 0; color: var(--ink-2); }
  .bar { position: relative; height: 10px; margin-top: 12px; border: 2px solid var(--line); border-radius: 5px; background: var(--surface); overflow: hidden; }
  .bar i { position: absolute; inset: 0 auto 0 0; width: 38%; background: var(--ink); animation: sweep 1.5s ease-in-out infinite; }
  .again, .stop {
    all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; margin-top: 12px; height: 32px; padding: 0 14px;
    border: 2px solid var(--line); border-radius: 8px; box-shadow: 3px 3px 0 var(--shadow); font: 800 12.5px/1 var(--font); color: var(--ink);
    transition: transform .08s ease, box-shadow .08s ease;
  }
  .again:active, .stop:active { transform: translate(3px, 3px); box-shadow: none; }
  /* Try again is the one primary action in view; Stop scan is secondary and outlined. */
  .again { background: var(--orange); color: #111111; }
  .stop { background: var(--surface); }
  @keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(270%); } }
  @media (prefers-reduced-motion: reduce) {
    .bar i { animation: none; width: 100%; opacity: .5; }
    .again, .stop { transition: none; }
    .again:active, .stop:active { transform: none; box-shadow: 3px 3px 0 var(--shadow); }
  }
`;

/**
 * The popover (style D): an outlined card with a solid offset shadow. Copy trade tears a stub off its
 * bottom along a dashed perforation with half-circle notches, which are painted in X's own page colour
 * (--page-bg) so they read as holes.
 */
export const POPOVER_CSS = `
  ${TOKENS_CSS}
  ${TWEET_CARD_CSS}
  :host { all: initial; }
  * { box-sizing: border-box; }
  .card {
    width: 344px; max-height: min(82vh, 700px, var(--avail, 700px)); overflow-y: auto; overflow-x: hidden; padding-bottom: 14px;
    border-radius: 14px; font: 13px/1.4 var(--font); color: var(--ink); background: var(--card);
    border: 2.5px solid var(--line); box-shadow: 6px 6px 0 var(--shadow); scrollbar-width: thin;
  }
  button:focus-visible, a:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }

  .top { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 0; }
  .brand { display: inline-flex; align-items: center; gap: 7px; font: 700 10.5px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-2); }
  .brand .mark { width: 15px; height: 15px; color: var(--line); flex: none; }
  .x {
    all: unset; box-sizing: border-box; cursor: pointer; width: 24px; height: 24px; border-radius: 7px; border: 2px solid var(--line);
    display: grid; place-items: center; color: var(--ink); font: 800 15px/1 var(--font);
  }
  .x:hover { background: var(--ticket); }

  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 16px 0; }
  ${TILE_CSS}
  .who { min-width: 0; flex: 1; }
  .handle { display: block; font: 800 22px/1.15 var(--font); letter-spacing: -.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .head .sub { margin-top: 4px; font: 500 12px/1.3 var(--mono); font-variant-numeric: tabular-nums; color: var(--ink-2); }
  /* Orange marks the #1 rank, and only that. */
  .rank.first { padding: 1px 5px; border-radius: 5px; background: var(--orange); color: #111111; font-weight: 700; }
  .delta {
    display: inline-flex; align-items: center; margin-top: 8px; padding: 3px 7px; border: 2px solid var(--line); border-radius: 6px;
    background: var(--surface); font: 700 11px/1.1 var(--mono); font-variant-numeric: tabular-nums;
  }
  .delta.up { color: var(--win); }
  .delta.down { color: var(--loss); }
  .note { margin: 8px 16px 0; color: var(--ink-2); font-size: 12px; }

  .kv { display: grid; grid-template-columns: 1fr 1fr 1.35fr; margin: 14px 16px 0; border: 2px solid var(--line); border-radius: 10px; overflow: hidden; }
  .kv > div { min-width: 0; padding: 8px 10px; }
  .kv > div + div { border-left: 2px solid var(--line); }
  .kv > div > span { display: block; font: 700 10px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-2); white-space: nowrap; }
  .kv b { display: block; margin-top: 5px; font: 800 18px/1.2 var(--font); font-variant-numeric: tabular-nums; letter-spacing: -.01em; white-space: nowrap; }
  .kv .w { color: var(--win); }
  .kv .l { color: var(--loss); }

  .picks { list-style: none; margin: 4px 0 0; padding: 0 16px; }
  .pick { perspective: 1000px; }
  .pick + .pick { border-top: 2px dashed rgba(127, 127, 127, .35); }
  .flip { position: relative; transition: height .45s cubic-bezier(.22, .8, .2, 1), transform .5s cubic-bezier(.22, .8, .2, 1); transform-style: preserve-3d; }
  .pick.flipped .flip { transform: rotateY(180deg); }
  .face { position: absolute; inset: 0 0 auto 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 10px; }
  /* The back face is the shared tweet card, in X's light colours (see TWEET_CARD_CSS). */
  .face.back {
    transform: rotateY(180deg);
    --tweetcard-bg: var(--tw-bg); --tweetcard-ink: var(--tw-ink); --tweetcard-ink-2: var(--tw-ink-2); --tweetcard-line: var(--tw-line);
    --tweetcard-avatar: var(--tw-avatar); --tweetcard-avatar-ink: var(--tw-avatar-ink); --tweetcard-link: var(--tw-link);
    --tweetcard-accent: var(--orange); --tweetcard-radius: 10px; --tweetcard-pad: 12px 14px 10px; --tweetcard-font: var(--font);
  }
  .tweetcard-acts .flipbtn { color: var(--tw-ink-2); }
  .tweetcard-acts .flipbtn:hover { color: var(--tw-ink); }
  .front { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 10px 0; }
  .pick .t { font: 700 13.5px/1.3 var(--font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The pick and price, with its links (See tweet, View market) on a line of their own below. */
  .pick .s { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; margin-top: 2px; font: 500 11.5px/1.3 var(--mono); color: var(--ink-2); }
  /* Not .rowlinks: clipping it would cut off its links' focus rings. */
  .pick .s > span:not(.rowlinks) { max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .flipbtn { all: unset; cursor: pointer; flex: none; color: var(--ink-3); font: 600 11.5px/1.3 var(--font); text-decoration: underline; text-underline-offset: 2px; }
  .flipbtn:hover { color: var(--ink); }
  .rowlinks { display: inline-flex; gap: 12px; align-items: baseline; white-space: nowrap; }
  .pts { font: 700 14px/1 var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
  .pts.won { color: var(--win); }
  .pts.lost { color: var(--loss); }
  .pts.none { color: var(--ink-3); font: 500 12px/1 var(--mono); }
  .pts.tag { padding: 4px 6px; border: 2px solid currentColor; border-radius: 6px; color: var(--ink-2); font: 700 10.5px/1 var(--mono); letter-spacing: .06em; }
  .empty { padding: 12px 16px 0; color: var(--ink-2); }

  .foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px 0; }
  .site {
    display: inline-flex; align-items: center; gap: 5px; min-width: 0; font: 700 12.5px/1.2 var(--font); color: var(--ink);
    text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px;
  }
  .site svg { width: 13px; height: 13px; flex: none; }
  .site:hover { color: var(--ink-2); }

  /* Buttons: outlined, with a solid offset shadow that a press takes away. */
  .tbtn, .btn, .rescan {
    all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    border: 2px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink); box-shadow: 3px 3px 0 var(--line);
    font: 700 13.5px/1 var(--font); white-space: nowrap; transition: transform .08s ease, box-shadow .08s ease;
  }
  .tbtn:hover, .btn:hover, .rescan:hover { background: var(--ticket); }
  .tbtn:active, .btn:active, .rescan:active, .tbtn.pressed { transform: translate(3px, 3px); box-shadow: none; }
  .tbtn[aria-busy="true"], .btn[aria-busy="true"] { opacity: .6; cursor: progress; }
  .tbtn svg { width: 14px; height: 14px; flex: none; }
  .rescan { flex: none; height: 30px; padding: 0 12px; font: 800 12px/1 var(--font); }
  .actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; padding: 14px 16px 0; }
  .tbtn { height: 40px; padding: 0 12px; font-size: 14.5px; }
  .tbtn.on { color: var(--win); }
  /* Copy trade is the card's one primary action, until its stub is open and the stub's button takes over. */
  .tbtn.copy { background: var(--orange); color: #111111; }
  .tbtn.copy.pressed { background: var(--surface); color: var(--ink); }
  .tbtn.copy.on { background: var(--ink); color: var(--card); box-shadow: 3px 3px 0 var(--orange); }
  .btn { height: 36px; padding: 0 14px; }
  .btn.primary { background: var(--orange); color: #111111; }
  .btn.primary:hover { background: var(--orange); }
  .btn.full { width: 100%; height: 46px; font: 800 16px/1 var(--font); box-shadow: 4px 4px 0 var(--line); }
  .btn.full:active { transform: translate(4px, 4px); box-shadow: none; }
  .btn.sm { height: 36px; padding: 0 8px; font-size: 13px; }
  .btn.danger { color: var(--loss); }

  .toast { margin: 12px 16px 0; padding: 9px 12px; border: 2px solid var(--line); border-radius: 9px; background: var(--ticket); font-size: 12px; color: var(--ink-2); }
  .toast.error { color: var(--loss); border-color: var(--loss); }
  .toast a { margin-left: 8px; color: var(--ink); font-weight: 700; }

  /* The stub: a perforation across the card with a half-circle notch at each edge, then the slip. */
  .perf { position: relative; margin-top: 16px; border-top: 2.5px dashed var(--line); }
  .perf::before, .perf::after {
    content: ""; position: absolute; top: -13.75px; box-sizing: content-box; width: 20px; height: 20px; border-radius: 50%;
    background: var(--page-bg); border: 2.5px solid var(--line);
  }
  .perf::before { left: -12.5px; clip-path: inset(-4px -4px -4px 50%); }
  .perf::after { right: -12.5px; clip-path: inset(-4px 50% -4px -4px); }
  .pstub { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px 4px; overflow: hidden; animation: tear .22s ease-out; }
  @keyframes tear { from { max-height: 0; opacity: 0; } to { max-height: 340px; opacity: 1; } }
  .ph { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font: 700 12.5px/1 var(--mono); letter-spacing: .08em; }
  .ph small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 11.5px/1 var(--mono); letter-spacing: .02em; color: var(--ink-2); }
  .pslip { font: 500 13px/1 var(--mono); }
  .pslip .li { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
  .pslip .li > span:first-child { white-space: nowrap; }
  .pslip .dots { flex: 1; min-width: 8px; border-bottom: 2px dotted var(--ink-3); opacity: .7; transform: translateY(4px); }
  .pslip .total { margin-top: 4px; padding-top: 10px; border-top: 2.5px solid var(--line); }
  .pslip .total b { font: 700 16px/1 var(--mono); font-variant-numeric: tabular-nums; }
  .pslip .w { color: var(--win); }
  .pslip .l { color: var(--loss); }
  .pslip .none { color: var(--ink-3); }
  .stp { display: inline-flex; align-items: center; flex: none; border: 2px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface); box-shadow: 2px 2px 0 var(--line); }
  .stp button { all: unset; cursor: pointer; width: 28px; height: 28px; display: grid; place-content: center; font: 800 16px/1 var(--font); color: var(--ink); }
  .stp button:first-child { border-right: 2px solid var(--line); }
  .stp button:last-child { border-left: 2px solid var(--line); }
  .stp button:hover:not(:disabled) { background: var(--ticket); }
  .stp button:disabled { color: var(--ink-3); cursor: not-allowed; }
  /* "all: unset" above also unsets the shared focus outline, so it is drawn again here. */
  .stp button:focus-visible { outline: 2px solid var(--orange); outline-offset: -3px; }
  .stp b { min-width: 48px; padding: 0 8px; text-align: center; font: 800 15px/1 var(--font); font-variant-numeric: tabular-nums; }
  .stamp {
    align-self: center; max-width: 100%; margin: 4px 0 2px; padding: 8px 14px; transform: rotate(-3deg); text-align: center; overflow-wrap: anywhere;
    border: 3px solid var(--win); border-radius: 10px; background: var(--win-soft); color: var(--win); font: 900 19px/1.1 var(--font); letter-spacing: -.01em;
  }
  .stamp small { display: block; margin-top: 4px; font: 700 11px/1.2 var(--mono); letter-spacing: .06em; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .fine { margin: 0; text-align: center; font: 500 11.5px/1.3 var(--mono); color: var(--ink-2); }
  .fine a { color: var(--ink); font-weight: 700; }

  .skeleton { display: grid; gap: 10px; padding: 16px 16px 4px; }
  .skeleton .sub { font: 500 12px/1.3 var(--mono); color: var(--ink-2); }
  .bar { height: 12px; border-radius: 6px; background: var(--ticket); border: 2px solid var(--line); opacity: .5; }
  .state { padding: 16px 16px 4px; color: var(--ink-2); }
  @media (prefers-reduced-motion: reduce) {
    .tbtn, .btn, .rescan { transition: none; }
    .tbtn:active, .btn:active, .rescan:active { transform: none; box-shadow: 3px 3px 0 var(--line); }
    .tbtn.pressed { transform: none; box-shadow: none; }
    .btn.full:active { box-shadow: 4px 4px 0 var(--line); }
    .pstub { animation: none; }
    .flip { transition: none; }
    .pick.flipped .flip { transform: none; }
    .face.back { transform: none; }
    .pick .face.back { display: none; } .pick.flipped .face.back { display: block; } .pick.flipped .face.front { display: none; }
  }
`;
