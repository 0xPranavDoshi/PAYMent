/**
 * The tweet card's one stylesheet. It defaults to X's dark theme and is themed by the host through
 * these variables (none are required): --tweetcard-bg, -ink, -ink-2, -line, -avatar, -avatar-ink,
 * -link, -accent (hover), -radius, -pad, -font.
 */
export const TWEET_CARD_CSS = `
.tweetcard {
  box-sizing: border-box; display: block; text-align: left;
  background: var(--tweetcard-bg, #000); color: var(--tweetcard-ink, #e7e9ea);
  border: 1px solid var(--tweetcard-line, #2f3336); border-radius: var(--tweetcard-radius, 16px);
  padding: var(--tweetcard-pad, 14px 16px);
  font-family: var(--tweetcard-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif);
}
.tweetcard *, .tweetcard *::before, .tweetcard *::after { box-sizing: border-box; }
.tweetcard-row { display: flex; gap: 10px; }
.tweetcard-av {
  width: 40px; height: 40px; flex: none; border-radius: 50%; display: grid; place-items: center;
  background: var(--tweetcard-avatar, #2f3336); color: var(--tweetcard-avatar-ink, #71767b); font: 700 17px/1 inherit;
}
.tweetcard-main { min-width: 0; flex: 1; }
.tweetcard-head { display: flex; gap: 4px; align-items: baseline; flex-wrap: wrap; font-size: 15px; line-height: 20px; color: var(--tweetcard-ink-2, #71767b); min-width: 0; }
.tweetcard-head b { font-weight: 700; color: var(--tweetcard-ink, #e7e9ea); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tweetcard-text {
  margin: 2px 0 0; font-size: 15px; line-height: 20px; color: var(--tweetcard-ink, #e7e9ea);
  white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; max-height: 200px; overflow-y: auto; overscroll-behavior: contain;
}
.tweetcard-text a { color: var(--tweetcard-link, #1d9bf0); text-decoration: none; }
.tweetcard-text a:hover { text-decoration: underline; }
.tweetcard-time { margin-top: 10px; font-size: 13px; line-height: 16px; color: var(--tweetcard-ink-2, #71767b); }
.tweetcard-foot {
  display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; padding-top: 8px;
  border-top: 1px solid var(--tweetcard-line, #2f3336); font-size: 12px; color: var(--tweetcard-ink-2, #71767b);
}
.tweetcard-note { min-width: 0; }
.tweetcard-acts { display: inline-flex; gap: 12px; align-items: center; flex: none; }
.tweetcard-acts a { color: var(--tweetcard-ink-2, #71767b); text-decoration: none; }
.tweetcard-acts a:hover { color: var(--tweetcard-accent, #1d9bf0); }
`;
