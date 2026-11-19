/** Styles for the popover. They live in its own shadow root, so X's CSS cannot reach them. */
export const POPOVER_CSS = `
  :host { all: initial; }
  .card {
    box-sizing: border-box; width: 320px; max-height: 70vh; overflow: auto;
    padding: 14px 16px; border-radius: 14px;
    background: #fff; color: #0f1419; border: 1px solid #cfd9de;
    box-shadow: 0 8px 28px rgba(0, 0, 0, .22);
    font: 14px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    .card { background: #15202b; color: #e7e9ea; border-color: #38444d; }
    .muted { color: #8b98a5 !important; }
    .row { border-color: #2f3b45 !important; }
    .close:hover { background: #22303c !important; }
  }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .handle { font-weight: 700; font-size: 15px; }
  .close {
    border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 18px;
    line-height: 1; width: 28px; height: 28px; border-radius: 14px;
  }
  .close:hover { background: #eff3f4; }
  .score { display: flex; align-items: baseline; gap: 8px; }
  .score .num { font-size: 34px; font-weight: 800; line-height: 1; }
  .score .num.new { font-size: 22px; color: #8b98a5; }
  .arrow { font-weight: 700; font-size: 14px; }
  .arrow.up { color: #00ba7c; }
  .arrow.down { color: #f4212e; }
  .muted { color: #536471; font-size: 13px; }
  .note { margin-top: 4px; }
  h3 { margin: 14px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #536471; }
  ul { list-style: none; margin: 0; padding: 0; }
  .row { padding: 8px 0; border-top: 1px solid #eff3f4; }
  .row:first-child { border-top: 0; }
  .line { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .event { font-weight: 600; }
  .pill { font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 9px; white-space: nowrap; }
  .pill.won { background: #d7f5e8; color: #057a55; }
  .pill.lost { background: #fde2e4; color: #c01b2a; }
  .pill.pending, .pill.scored { background: #e8f0fe; color: #1d4ed8; }
  .pill.void { background: #eef0f2; color: #536471; }
  .detail { display: flex; justify-content: space-between; gap: 8px; margin-top: 2px; }
  a { color: #1d9bf0; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .foot { margin-top: 12px; padding-top: 10px; border-top: 1px solid #eff3f4; display: flex; justify-content: flex-end; }
  .retry { margin-top: 8px; border: 1px solid currentColor; background: transparent; color: #1d9bf0; border-radius: 14px; padding: 4px 12px; cursor: pointer; font: inherit; }
`;
