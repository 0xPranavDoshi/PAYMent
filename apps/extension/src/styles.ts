import { TOKENS, TOKENS_DARK, tokensCss } from "@copayme/shared";
import { TWEET_CARD_CSS } from "@copayme/tweet-card";

/**
 * coPAYMe's look (style D): thick outlines and solid offset shadows. Light is warm paper with black
 * outlines; dark (variant B) is near-black with cream outlines and an orange shadow. All of it comes
 * from the shared tokens, so components just use var(--line) and var(--shadow). Everything lives in shadow roots, so
 * X's styles cannot touch it and ours cannot leak out. The theme comes from `data-theme` on the
 * shadow host, kept in sync with X's own theme.
 */
export const TOKENS_CSS = `
  ${tokensCss(":host", TOKENS)}
  ${tokensCss(':host([data-theme="dark"])', TOKENS_DARK)}
  :host {
    --font: "Archivo", "Helvetica Neue", Arial, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
    --pill-bg: var(--surface);
    --pill-dim: var(--ink-3);
    --offset: 3px 3px 0 var(--shadow);
    /* Names the popover (rebuilt in Task 13) still reads, mapped onto the style D tokens. */
    --pill-ink: var(--ink); --rim: var(--line); --ember: var(--orange); --ember-ink: #111111; --coral: var(--loss);
    --card-bg: var(--card); --card-line: var(--line); --card-shadow: 4px 4px 0 var(--shadow);
    --chip: var(--ticket); --chip-line: var(--line); --raised: var(--ticket); --focus: var(--orange);
    /* X's own colours, so a tweet shown here looks like the ones on the page. --tw-bg is replaced
       with the page's exact background by the extension. */
    --tw-link: #1d9bf0; --tw-bg: #ffffff; --tw-ink: #0f1419; --tw-ink-2: #536471; --tw-line: #eff3f4; --tw-avatar: #cfd9de; --tw-avatar-ink: #536471;
  }
  :host([data-theme="dark"]) {
    --pill-bg: var(--card);
    --ember-ink: #111111;
    --tw-link: #1d9bf0; --tw-bg: #000000; --tw-ink: #e7e9ea; --tw-ink-2: #71767b; --tw-line: #2f3336; --tw-avatar: #2f3336; --tw-avatar-ink: #e7e9ea;
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
  .pill {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px;
    height: 24px; padding: 0 8px 0 3px; border: 2px solid var(--line); border-radius: 7px; cursor: pointer;
    font: 800 13px/1 var(--font); color: var(--ink); white-space: nowrap; background: var(--pill-bg);
    box-shadow: 2px 2px 0 var(--shadow);
  }
  .pill:active { transform: translate(2px, 2px); box-shadow: none; }
  .pill:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }
  .mark { width: 16px; height: 16px; color: var(--line); flex: none; display: block; }
  .num { font: 800 13px/1 var(--font); font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .arrow { font: 800 12px/1 var(--font); font-variant-numeric: tabular-nums; }
  .arrow.up { color: var(--win); }
  .arrow.down { color: var(--loss); }
  .pill.new, .pill.scanning, .pill.empty { border-style: dashed; box-shadow: none; }
  .pill.new .num { font: 700 10px/1 var(--mono); letter-spacing: .08em; color: var(--ink-2); }
  .pill.scanning { cursor: progress; }
  .pill.scanning .num { font: 700 11px/1 var(--mono); color: var(--ink-2); }
  .pill.scanning .clock { font: 700 11px/1 var(--mono); font-variant-numeric: tabular-nums; color: var(--ink); }
  .pill.offer .num { font: 800 12px/1 var(--font); }
  .pill.empty .num { font: 700 11px/1 var(--mono); color: var(--ink-2); }
  .pill.failed { border-color: var(--loss); }
  .pill.failed .num { font: 800 12px/1 var(--font); color: var(--loss); }
  @media (prefers-reduced-motion: reduce) { .pill:active { transform: none; box-shadow: 2px 2px 0 var(--shadow); } }
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

export const POPOVER_CSS = `
  ${TOKENS_CSS}
  ${TWEET_CARD_CSS}
  :host { all: initial; }
  * { box-sizing: border-box; }
  .card {
    width: 344px; max-height: min(82vh, 700px, var(--avail, 700px)); overflow-y: auto; overflow-x: hidden; border-radius: 16px;
    font: 13px/1.4 var(--font); color: var(--ink); background: var(--card-bg);
    border: 1px solid var(--card-line); box-shadow: var(--card-shadow); scrollbar-width: thin;
  }
  .top { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 0; }
  .brand { display: inline-flex; align-items: center; gap: 7px; font: 700 11px/1 var(--font); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2); }
  .brand .mark { width: 15px; height: 15px; color: var(--ember); }
  .x { all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 13px; display: grid; place-items: center; color: var(--ink-2); font-size: 17px; line-height: 1; }
  .x:hover { background: var(--chip); color: var(--ink); }
  .x:focus-visible, .btn:focus-visible, .tbtn:focus-visible, .link:focus-visible, .chip:focus-visible, .flipbtn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

  .hero { display: flex; align-items: center; gap: 16px; padding: 14px 16px 6px; }
  ${TILE_CSS}
  .who { min-width: 0; }
  .handle { font: 700 16px/1.2 var(--font); letter-spacing: -.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { color: var(--ink-2); margin-top: 3px; }
  .delta { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; padding: 2px 8px; border-radius: 10px; font: 700 11px/1.3 var(--font); font-variant-numeric: tabular-nums; background: var(--chip); border: 1px solid var(--chip-line); }
  .delta.up { color: var(--win); }
  .delta.down { color: var(--coral); }
  .note { margin: 4px 16px 0; color: var(--ink-2); font-size: 12px; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); margin: 10px 16px 0; border-top: 1px solid var(--card-line); border-bottom: 1px solid var(--card-line); }
  .stats div { padding: 10px 0; }
  .stats div + div { padding-left: 12px; border-left: 1px solid var(--card-line); }
  .stats b { display: block; font: 700 15px/1.1 var(--font); font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .stats b .w, .stats b.w { color: var(--win); }
  .stats b .l, .stats b.l { color: var(--coral); }
  .stats > div > span { color: var(--ink-3); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }

  .actions { display: flex; gap: 8px; padding: 12px 16px 0; }
  .tbtn {
    all: unset; box-sizing: border-box; flex: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    gap: 7px; height: 32px; padding: 0 12px; border-radius: 16px; font: 600 12.5px/1 var(--font); white-space: nowrap;
    color: var(--ink); border: 1px solid var(--chip-line); transition: border-color .12s ease, background .12s ease;
  }
  .tbtn svg { width: 14px; height: 14px; flex: none; }
  .tbtn svg:last-child:not(:first-child) { width: 12px; height: 12px; margin-left: -2px; opacity: .85; }
  .tbtn:hover { border-color: var(--ink-3); background: var(--chip); }
  .tbtn.solid { background: var(--ember); border-color: var(--ember); color: var(--ember-ink); }
  .tbtn.solid:hover { background: var(--ember); filter: brightness(1.07); }
  .tbtn.on { color: var(--win); border-color: var(--win); }
  .tbtn.on:hover { background: var(--chip); }
  .tbtn.solid.on { background: var(--ember); border-color: var(--ember); color: var(--ember-ink); }
  .tbtn[aria-busy="true"] { opacity: .6; cursor: progress; }
  .btn { all: unset; box-sizing: border-box; cursor: pointer; text-align: center; padding: 10px 8px; border-radius: 12px; font: 700 13px/1.1 var(--font); border: 1px solid var(--chip-line); background: var(--chip); color: var(--ink); }
  .btn:hover { border-color: var(--ink-3); }
  .btn.primary { background: var(--ember); color: var(--ember-ink); border-color: var(--ember); }
  .btn.primary:hover { filter: brightness(1.06); }
  .btn.sm { padding: 7px 12px; font-size: 12px; border-radius: 10px; }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  .menu { margin: 8px 16px 0; padding: 4px; border-radius: 12px; background: var(--raised); border: 1px solid var(--card-line); display: grid; }
  .menu button { all: unset; cursor: pointer; padding: 9px 10px; border-radius: 8px; font: 600 13px/1 var(--font); color: var(--ink); }
  .menu button:hover, .menu button:focus-visible { background: var(--chip); }
  .menu button.danger { color: var(--coral); }
  .toast a { margin-left: 8px; color: var(--ember); font-weight: 600; text-decoration: none; }
  .toast a:hover { text-decoration: underline; }
  .amount { flex: 1.3; display: flex; align-items: center; gap: 2px; padding: 0 8px; border-radius: 9px; border: 1px solid var(--chip-line); color: var(--ink-2); font: 700 12px/1 var(--font); }
  .amount.active { border-color: var(--ember); color: var(--ember); }
  .amount.bad { border-color: var(--coral); color: var(--coral); }
  .amount input { all: unset; width: 100%; min-width: 0; padding: 7px 0; color: var(--ink); font: 700 12px/1 var(--font); font-variant-numeric: tabular-nums; }
  .amount input::placeholder { color: var(--ink-3); font-weight: 500; }
  .hint { margin: -4px 0 10px; color: var(--coral); font-size: 11.5px; }
  .panel { margin: 10px 16px 0; padding: 12px; border-radius: 12px; background: var(--raised); border: 1px solid var(--card-line); }
  .panel p { margin: 0 0 10px; color: var(--ink-2); font-size: 12px; }
  .panel p b { color: var(--ink); }
  .chips { display: flex; gap: 6px; margin-bottom: 10px; }
  .chip { all: unset; cursor: pointer; flex: 1; box-sizing: border-box; text-align: center; padding: 7px 0; border-radius: 9px; font: 700 12px/1 var(--font); border: 1px solid var(--chip-line); color: var(--ink); font-variant-numeric: tabular-nums; }
  .chip[aria-pressed="true"] { border-color: var(--ember); color: var(--ember); }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .toast { margin: 10px 16px 0; padding: 9px 12px; border-radius: 10px; font-size: 12px; background: var(--chip); border: 1px solid var(--chip-line); color: var(--ink-2); }
  .toast.error { color: var(--coral); border-color: var(--coral); }

  .sec { padding: 14px 16px 4px; font: 700 11px/1 var(--font); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); }
  .picks { list-style: none; margin: 0; padding: 0 8px 6px; }
  .pick { perspective: 1000px; }
  .flip { position: relative; transition: height .45s cubic-bezier(.22, .8, .2, 1), transform .5s cubic-bezier(.22, .8, .2, 1); transform-style: preserve-3d; }
  .pick.flipped .flip { transform: rotateY(180deg); }
  .face { position: absolute; inset: 0 0 auto 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 10px; }
  /* The back face is the shared tweet card, themed from X's own colours (see TWEET_CARD_CSS). */
  .face.back {
    transform: rotateY(180deg);
    --tweetcard-bg: var(--tw-bg); --tweetcard-ink: var(--tw-ink); --tweetcard-ink-2: var(--tw-ink-2); --tweetcard-line: var(--tw-line);
    --tweetcard-avatar: var(--tw-avatar); --tweetcard-avatar-ink: var(--tw-avatar-ink); --tweetcard-link: var(--tw-link);
    --tweetcard-accent: var(--ember); --tweetcard-radius: 10px; --tweetcard-pad: 12px 14px 10px; --tweetcard-font: var(--font);
  }
  .tweetcard-acts .flipbtn { color: var(--tw-ink-2); }
  .tweetcard-acts .flipbtn:hover { color: var(--ember); }
  .front { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 9px 8px; }
  .front:hover { background: var(--chip); }
  .pick .t { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pick .s { color: var(--ink-2); font-size: 12px; margin-top: 1px; display: flex; gap: 8px; align-items: baseline; }
  .flipbtn { all: unset; cursor: pointer; color: var(--ink-3); font-size: 12px; }
  .flipbtn:hover { color: var(--ember); text-decoration: underline; }
  .pts { font: 700 13px/1 var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
  .pts.won { color: var(--win); }
  .pts.lost { color: var(--coral); }
  .pts.none { color: var(--ink-3); font: 500 12px/1 var(--font); }
  .empty { padding: 4px 16px 10px; color: var(--ink-2); }
  .foot { padding: 12px 16px 16px; }
  .site {
    display: flex; align-items: center; justify-content: center; gap: 8px; height: 40px; border-radius: 20px; text-decoration: none;
    font: 700 13px/1 var(--font); color: var(--ember); border: 1.5px solid var(--ember); transition: background .12s ease, color .12s ease;
  }
  .site svg { width: 14px; height: 14px; flex: none; }
  .site:hover { background: var(--ember); color: var(--ember-ink); }
  .site:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .rescan {
    all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: 100%; height: 36px; margin-top: 8px; cursor: pointer;
    background: var(--surface); border: 2px solid var(--line); border-radius: 8px; box-shadow: 3px 3px 0 var(--shadow);
    font: 800 12.5px/1 var(--font); color: var(--ink); transition: transform .08s ease, box-shadow .08s ease;
  }
  .rescan:hover { background: var(--ticket); }
  .rescan:active { transform: translate(3px, 3px); box-shadow: none; }
  .rescan:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .rescan { transition: none; } .rescan:active { transform: none; box-shadow: 3px 3px 0 var(--shadow); } }
  .link { color: var(--ink-2); text-decoration: none; }
  .link:hover { color: var(--ember); }
  .skeleton { display: grid; gap: 10px; padding: 18px 16px 8px; }
  .bar { height: 12px; border-radius: 6px; background: var(--chip-line); animation: pulse 1.2s ease-in-out infinite; }
  .state { padding: 16px; color: var(--ink-2); }
  @keyframes pulse { 50% { opacity: .45; } }
  @media (prefers-reduced-motion: reduce) {
    .bar { animation: none; }
    .flip { transition: none; }
    .pick.flipped .flip { transform: none; }
    .face.back { transform: none; }
    .pick .face.back { display: none; } .pick.flipped .face.back { display: block; } .pick.flipped .face.front { display: none; }
  }
`;
