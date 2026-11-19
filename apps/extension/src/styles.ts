/**
 * coPAYMe's look: flat, high-contrast surfaces. Near-black in dark, warm paper in light, one ember
 * accent, green for wins and coral for losses. No gradients. Everything lives in shadow roots, so
 * X's styles cannot touch it and ours cannot leak out. The theme comes from `data-theme` on the
 * shadow host, kept in sync with X's own theme.
 */
export const TOKENS_CSS = `
  :host {
    --font: ui-sans-serif, -apple-system, "SF Pro Text", "Segoe UI", Inter, system-ui, sans-serif;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    --pill-bg: #fffdf8; --pill-ink: #17140f; --pill-dim: #756f63; --rim: #e3b79a;
    --card-bg: #fffdf8; --card-line: rgba(23, 20, 15, .12);
    --card-shadow: 0 0 0 1px rgba(23, 20, 15, .04), 0 12px 32px rgba(40, 28, 16, .20);
    --ink: #17140f; --ink-2: #5f594e; --ink-3: #756f63;
    --ember: #c8461a; --ember-ink: #fffdf8; --win: #17794a; --coral: #b8321f;
    --chip: rgba(23, 20, 15, .05); --chip-line: rgba(23, 20, 15, .14);
    --raised: #f6f1e6;
    --ring-s: 82%; --ring-l: 38%; /* the score ring: hue comes from the score, these make it readable on this theme */
    --focus: #c8461a;
    /* X's own colours, so a tweet shown here looks like the ones on the page. --tw-bg is replaced
       with the page's exact background by the extension. */
    --tw-link: #1d9bf0; --tw-bg: #ffffff; --tw-ink: #0f1419; --tw-ink-2: #536471; --tw-line: #eff3f4; --tw-avatar: #cfd9de; --tw-avatar-ink: #536471;
  }
  :host([data-theme="dark"]) {
    --pill-bg: #131315; --pill-ink: #f6f1e7; --pill-dim: #8b867b; --rim: #6b3f26;
    --card-bg: #121214; --card-line: rgba(255, 244, 230, .12);
    --card-shadow: 0 0 0 1px rgba(0, 0, 0, .6), 0 16px 40px rgba(0, 0, 0, .6);
    --ink: #f6f1e7; --ink-2: #aaa59a; --ink-3: #8b867b;
    --ember: #ff7a3d; --ember-ink: #1a0d05; --win: #5cd08c; --coral: #ef5b45;
    --chip: rgba(255, 244, 230, .06); --chip-line: rgba(255, 244, 230, .14);
    --raised: #1a1a1d;
    --ring-s: 70%; --ring-l: 56%;
    --focus: #ffb36b;
    --tw-link: #1d9bf0; --tw-bg: #000000; --tw-ink: #e7e9ea; --tw-ink-2: #71767b; --tw-line: #2f3336; --tw-avatar: #2f3336; --tw-avatar-ink: #e7e9ea;
  }
`;

export const BADGE_CSS = `
  ${TOKENS_CSS}
  :host { all: initial; display: inline-flex; vertical-align: middle; margin-left: 6px; }
  .pill {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px;
    height: 24px; padding: 0 10px 0 7px; border: 1px solid var(--rim); border-radius: 12px; cursor: pointer;
    font-family: var(--font); color: var(--pill-ink); white-space: nowrap; background: var(--pill-bg);
    transition: border-color .12s ease, transform .12s ease;
  }
  .pill:hover { border-color: var(--ember); transform: translateY(-1px); }
  .pill:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .mark { width: 14px; height: 14px; color: var(--ember); flex: none; }
  .cap { font: 700 9px/1 var(--font); letter-spacing: .12em; color: var(--pill-dim); }
  .num { font: 700 13px/1 var(--font); font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .arrow { font: 700 11px/1 var(--font); font-variant-numeric: tabular-nums; }
  .arrow.up { color: var(--win); }
  .arrow.down { color: var(--coral); }
  .pill.new { border-style: dashed; border-color: var(--chip-line); }
  .pill.new .mark { color: var(--pill-dim); }
  .pill.new .num { font: 700 10px/1 var(--font); letter-spacing: .12em; color: var(--pill-dim); }
  .pill.scanning { border-style: dashed; border-color: var(--chip-line); cursor: progress; }
  .pill.scanning .num { font: 600 11px/1 var(--font); font-style: italic; color: var(--pill-dim); }
  .pill.scanning .mark { color: var(--pill-dim); animation: spin 1.1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .pill.scanning { animation: glow 1.6s ease-in-out infinite; }
  .pill.scanning .clock { font: 700 11px/1 var(--font); font-variant-numeric: tabular-nums; color: var(--ember); }
  @keyframes glow { 50% { border-color: var(--ember); } }
  .pill.offer { border-color: var(--ember); }
  .pill.offer .num { font: 700 11px/1 var(--font); color: var(--ember); }
  .pill.offer .mark { color: var(--ember); }
  .pill.empty { border-style: dashed; border-color: var(--chip-line); cursor: pointer; }
  .pill.empty .num, .pill.empty .mark { font: 600 11px/1 var(--font); color: var(--pill-dim); }
  .pill.failed { border-color: var(--coral); }
  .pill.failed .num { font: 700 11px/1 var(--font); color: var(--coral); }
  .pill.failed .mark { color: var(--coral); }
  @media (prefers-reduced-motion: reduce) { .pill { transition: none; } .pill:hover { transform: none; } .pill.scanning .mark { animation: none; } .pill.scanning { animation: none; } }
`;

/** The corner card that shows a scan running, and how it ended. */
export const SCAN_CSS = `
  ${TOKENS_CSS}
  :host { all: initial; }
  * { box-sizing: border-box; }
  .scan {
    width: 320px; padding: 14px 16px 16px; border-radius: 14px; font-family: var(--font); font-size: 13px; line-height: 1.4;
    background: var(--card-bg); color: var(--ink); border: 1px solid var(--card-line); box-shadow: var(--card-shadow);
  }
  .scan.failed { border-color: var(--coral); }
  .head { display: flex; align-items: center; gap: 8px; }
  .head b { font-size: 14px; letter-spacing: -.01em; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mark { width: 16px; height: 16px; color: var(--ember); flex: none; }
  .scan.failed .mark { color: var(--coral); }
  .mark.spin { animation: spin 1.1s linear infinite; }
  .clock { font: 700 13px/1 var(--font); font-variant-numeric: tabular-nums; color: var(--ember); }
  .x { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 11px; display: grid; place-items: center; color: var(--ink-3); font-size: 16px; line-height: 1; }
  .x:hover { background: var(--chip); color: var(--ink); }
  .x:focus-visible, .again:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  p { margin: 10px 0 0; color: var(--ink-2); }
  .bar { position: relative; height: 4px; margin-top: 12px; border-radius: 2px; background: var(--chip); overflow: hidden; }
  .bar i { position: absolute; inset: 0 auto 0 0; width: 38%; border-radius: 2px; background: var(--ember); animation: sweep 1.5s ease-in-out infinite; }
  .again { all: unset; cursor: pointer; margin-top: 12px; padding: 8px 14px; border-radius: 999px; background: var(--ember); color: var(--ember-ink); font: 700 12px/1 var(--font); }
  .again:hover { filter: brightness(1.07); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(270%); } }
  @media (prefers-reduced-motion: reduce) { .mark.spin { animation: none; } .bar i { animation: none; width: 100%; opacity: .5; } }
`;

export const POPOVER_CSS = `
  ${TOKENS_CSS}
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
  .gauge { position: relative; width: 80px; height: 80px; flex: none; }
  .gauge svg { width: 80px; height: 80px; transform: rotate(-90deg); display: block; }
  .gauge .track { stroke: var(--chip-line); }
  .gauge .fill { stroke: hsl(var(--ring-h, 20) var(--ring-s) var(--ring-l)); animation: ring 1s cubic-bezier(.22, .8, .2, 1) both; }
  @keyframes ring { from { stroke-dasharray: 0 var(--c); } to { stroke-dasharray: var(--dash) var(--c); } }
  .gauge .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; }
  .gauge .score { font: 800 26px/1 var(--font); font-variant-numeric: tabular-nums; letter-spacing: -.03em; }
  .gauge .score.new { font: 700 13px/1 var(--font); letter-spacing: .1em; color: var(--ink-2); }
  .gauge .cap { font: 700 9px/1 var(--font); letter-spacing: .16em; color: var(--ink-3); }
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
  .face.back { transform: rotateY(180deg); background: var(--tw-bg); color: var(--tw-ink); border: 1px solid var(--tw-line); padding: 12px 14px 10px; }
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
  .tweet { display: flex; gap: 10px; }
  .avatar { width: 40px; height: 40px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--tw-avatar); color: var(--tw-avatar-ink); font: 700 17px/1 var(--font); }
  .tmain { min-width: 0; flex: 1; }
  .thead { display: flex; gap: 4px; align-items: baseline; font: 15px/20px var(--font); color: var(--tw-ink-2); min-width: 0; }
  .thead b { font-weight: 700; color: var(--tw-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ttext { margin: 2px 0 0; font: 15px/20px var(--font); color: var(--tw-ink); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; max-height: 200px; overflow-y: auto; overscroll-behavior: contain; }
  .ttext a { color: var(--tw-link); text-decoration: none; }
  .ttext a:hover { text-decoration: underline; }
  .tmeta { margin-top: 10px; font: 13px/16px var(--font); color: var(--tw-ink-2); }
  .tfoot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--tw-line); font-size: 12px; color: var(--tw-ink-2); }
  .tfoot .link, .tfoot .flipbtn { color: var(--tw-ink-2); }
  .tfoot .link:hover, .tfoot .flipbtn:hover { color: var(--ember); }
  .tfoot .acts { display: inline-flex; gap: 12px; align-items: center; }
  .empty { padding: 4px 16px 10px; color: var(--ink-2); }
  .foot { padding: 12px 16px 16px; }
  .site {
    display: flex; align-items: center; justify-content: center; gap: 8px; height: 40px; border-radius: 20px; text-decoration: none;
    font: 700 13px/1 var(--font); color: var(--ember); border: 1.5px solid var(--ember); transition: background .12s ease, color .12s ease;
  }
  .site svg { width: 14px; height: 14px; flex: none; }
  .site:hover { background: var(--ember); color: var(--ember-ink); }
  .site:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .link { color: var(--ink-2); text-decoration: none; }
  .link:hover { color: var(--ember); }
  .skeleton { display: grid; gap: 10px; padding: 18px 16px 8px; }
  .bar { height: 12px; border-radius: 6px; background: var(--chip-line); animation: pulse 1.2s ease-in-out infinite; }
  .state { padding: 16px; color: var(--ink-2); }
  @keyframes pulse { 50% { opacity: .45; } }
  @media (prefers-reduced-motion: reduce) {
    .bar, .gauge .fill { animation: none; }
    .gauge .fill { stroke-dasharray: var(--dash) var(--c); }
    .flip { transition: none; }
    .pick.flipped .flip { transform: none; }
    .face.back { transform: none; }
    .pick .face.back { display: none; } .pick.flipped .face.back { display: block; } .pick.flipped .face.front { display: none; }
  }
`;
