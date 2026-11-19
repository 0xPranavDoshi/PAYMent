/**
 * coPAYMe's look: chiaroscuro. Deep, tonal darks lit by one warm source, and warm paper and ink
 * in light. One accent (ember), wins in gold and losses in coral. No purple or green.
 * Everything lives in shadow roots, so X's styles cannot touch it and ours cannot leak out.
 * The theme comes from `data-theme` on the shadow host, kept in sync with X's own theme.
 */
export const TOKENS_CSS = `
  :host {
    --font: ui-sans-serif, -apple-system, "SF Pro Text", "Segoe UI", Inter, system-ui, sans-serif;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    --pill-bg: #fffdf8; --pill-ink: #17140f; --pill-dim: #756f63;
    --rim-a: #e0743a; --rim-b: #f0c9a8; --rim-c: #e8dfd0;
    --glow: rgba(224, 116, 58, .20);
    --card-bg: #fffdf8; --card-hi: rgba(255, 255, 255, .9); --card-line: rgba(23, 20, 15, .10);
    --card-shadow: 0 0 0 1px rgba(23, 20, 15, .06), 0 18px 44px rgba(60, 40, 20, .22);
    --ink: #17140f; --ink-2: #5f594e; --ink-3: #756f63;
    --ember: #c8461a; --ember-ink: #fffdf8; --gold: #8a5d00; --coral: #b8321f;
    --chip: rgba(23, 20, 15, .05); --chip-line: rgba(23, 20, 15, .12);
    --focus: #c8461a;
  }
  :host([data-theme="dark"]) {
    --pill-bg: #131315; --pill-ink: #f6f1e7; --pill-dim: #8b867b;
    --rim-a: #ffb36b; --rim-b: #5a2a14; --rim-c: #2b2420;
    --glow: rgba(255, 150, 70, .28);
    --card-bg: #101012; --card-hi: rgba(255, 236, 210, .10); --card-line: rgba(255, 244, 230, .09);
    --card-shadow: 0 0 0 1px rgba(0, 0, 0, .6), 0 24px 60px rgba(0, 0, 0, .65);
    --ink: #f6f1e7; --ink-2: #aaa59a; --ink-3: #8b867b;
    --ember: #ff7a3d; --ember-ink: #1a0d05; --gold: #f2c14e; --coral: #ef5b45;
    --chip: rgba(255, 244, 230, .06); --chip-line: rgba(255, 244, 230, .12);
    --focus: #ffb36b;
  }
`;

export const BADGE_CSS = `
  ${TOKENS_CSS}
  :host { all: initial; display: inline-flex; vertical-align: middle; margin-left: 6px; }
  .pill {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px;
    height: 24px; padding: 0 10px 0 7px; border: 1px solid transparent; border-radius: 12px; cursor: pointer;
    font-family: var(--font); color: var(--pill-ink); white-space: nowrap;
    background:
      radial-gradient(120% 140% at 0% 0%, var(--glow), transparent 60%) padding-box,
      linear-gradient(var(--pill-bg), var(--pill-bg)) padding-box,
      linear-gradient(135deg, var(--rim-a), var(--rim-b) 55%, var(--rim-c)) border-box;
    box-shadow: 0 1px 0 rgba(255, 255, 255, .04) inset, 0 2px 8px rgba(0, 0, 0, .25);
    transition: transform .12s ease, box-shadow .12s ease;
  }
  .pill:hover { transform: translateY(-1px); box-shadow: 0 1px 0 rgba(255, 255, 255, .06) inset, 0 6px 16px rgba(0, 0, 0, .35); }
  .pill:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .mark { width: 14px; height: 14px; color: var(--rim-a); flex: none; }
  .num { font: 700 13px/1 var(--font); font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .arrow { font: 700 11px/1 var(--font); font-variant-numeric: tabular-nums; }
  .arrow.up { color: var(--gold); }
  .arrow.down { color: var(--coral); }
  .pill.new {
    border-style: dashed;
    background: linear-gradient(var(--pill-bg), var(--pill-bg)) padding-box, linear-gradient(135deg, var(--rim-b), var(--rim-c)) border-box;
  }
  .pill.new .mark { color: var(--pill-dim); }
  .pill.new .num { font: 700 10px/1 var(--font); letter-spacing: .12em; color: var(--pill-dim); }
  @media (prefers-reduced-motion: reduce) { .pill { transition: none; } .pill:hover { transform: none; } }
`;

export const POPOVER_CSS = `
  ${TOKENS_CSS}
  :host { all: initial; }
  * { box-sizing: border-box; }
  .card {
    width: 344px; max-height: min(82vh, 680px); overflow: auto; border-radius: 18px;
    font: 13px/1.4 var(--font); color: var(--ink);
    background: radial-gradient(90% 70% at 0% 0%, var(--glow), transparent 62%), var(--card-bg);
    border: 1px solid var(--card-line); box-shadow: var(--card-shadow), inset 0 1px 0 var(--card-hi);
    scrollbar-width: thin;
  }
  .top { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 0; }
  .brand { display: inline-flex; align-items: center; gap: 7px; font: 700 11px/1 var(--font); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2); }
  .brand .mark { width: 15px; height: 15px; color: var(--ember); }
  .x { all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 13px; display: grid; place-items: center; color: var(--ink-2); font-size: 17px; line-height: 1; }
  .x:hover { background: var(--chip); color: var(--ink); }
  .x:focus-visible, .btn:focus-visible, .link:focus-visible, .chip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .hero { display: flex; align-items: center; gap: 16px; padding: 14px 16px 6px; }
  .gauge { position: relative; width: 72px; height: 72px; flex: none; }
  .gauge svg { width: 72px; height: 72px; transform: rotate(-90deg); display: block; }
  .gauge .track { stroke: var(--chip-line); }
  .gauge .fill { stroke: var(--ember); filter: drop-shadow(0 0 6px var(--glow)); }
  .gauge .score { position: absolute; inset: 0; display: grid; place-items: center; font: 800 26px/1 var(--font); font-variant-numeric: tabular-nums; letter-spacing: -.03em; }
  .gauge .score.new { font: 700 11px/1 var(--font); letter-spacing: .14em; color: var(--ink-2); }
  .who { min-width: 0; }
  .handle { font: 700 16px/1.2 var(--font); letter-spacing: -.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { color: var(--ink-2); margin-top: 3px; }
  .delta { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; padding: 2px 8px; border-radius: 10px; font: 700 11px/1.3 var(--font); font-variant-numeric: tabular-nums; background: var(--chip); border: 1px solid var(--chip-line); }
  .delta.up { color: var(--gold); }
  .delta.down { color: var(--coral); }
  .note { margin: 4px 16px 0; color: var(--ink-2); font-size: 12px; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); margin: 10px 16px 0; border-top: 1px solid var(--card-line); border-bottom: 1px solid var(--card-line); }
  .stats div { padding: 10px 0; }
  .stats div + div { padding-left: 12px; border-left: 1px solid var(--card-line); }
  .stats b { display: block; font: 700 15px/1.1 var(--font); font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .stats span { color: var(--ink-3); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
  .sec { padding: 14px 16px 4px; font: 700 11px/1 var(--font); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); }
  .picks { list-style: none; margin: 0; padding: 0 8px 6px; }
  .pick { display: grid; grid-template-columns: 14px 1fr auto; gap: 10px; align-items: center; padding: 9px 8px; border-radius: 10px; }
  .pick:hover { background: var(--chip); }
  .dot { width: 9px; height: 9px; border-radius: 50%; justify-self: center; }
  .dot.won { background: var(--gold); box-shadow: 0 0 10px var(--glow); }
  .dot.lost { background: var(--coral); }
  .dot.scored { background: var(--ink-3); }
  .dot.pending { border: 1.5px solid var(--ember); }
  .dot.void { border: 1.5px dashed var(--ink-3); }
  .pick .t { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pick .s { color: var(--ink-2); font-size: 12px; margin-top: 1px; display: flex; gap: 8px; align-items: baseline; }
  .pick .s a { color: var(--ink-3); text-decoration: none; }
  .pick .s a:hover { color: var(--ember); }
  .pts { font: 700 13px/1 var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
  .pts.won { color: var(--gold); }
  .pts.lost { color: var(--coral); }
  .pts.none { color: var(--ink-3); font: 500 12px/1 var(--font); }
  .empty { padding: 4px 16px 10px; color: var(--ink-2); }
  .foot { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px 14px; color: var(--ink-3); font-size: 12px; }
  .link { color: var(--ink-2); text-decoration: none; }
  .link:hover { color: var(--ember); }
  .btn { all: unset; box-sizing: border-box; cursor: pointer; text-align: center; padding: 10px; border-radius: 12px; font: 700 13px/1.1 var(--font); border: 1px solid var(--chip-line); background: var(--chip); color: var(--ink); }
  .btn:hover { border-color: var(--ink-3); }
  .btn.primary { background: linear-gradient(180deg, color-mix(in srgb, var(--ember) 92%, white), var(--ember)); color: var(--ember-ink); border-color: transparent; box-shadow: 0 6px 18px var(--glow); }
  .skeleton { display: grid; gap: 10px; padding: 18px 16px 8px; }
  .bar { height: 12px; border-radius: 6px; background: var(--chip-line); animation: pulse 1.2s ease-in-out infinite; }
  .state { padding: 16px; color: var(--ink-2); }
  @keyframes pulse { 50% { opacity: .45; } }
  @media (prefers-reduced-motion: reduce) { .bar { animation: none; } }
`;
