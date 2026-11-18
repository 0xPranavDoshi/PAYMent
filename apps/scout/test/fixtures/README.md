# Fixtures

`apify-kaito.json` is REAL, recorded Nov 18 2026 from the actor for `from:espn` (20 items), trimmed to 5 items: one retweet (first), three plain tweets and the one reply. Each item keeps only `type, id, url, text, createdAt, lang, isReply, inReplyToId, inReplyToUsername, conversationId, isRetweet, retweeted_tweet (trimmed to {id, text}), quoted_tweet, author (trimmed to type, userName, id, name)`. Note that the actor omits `isRetweet` on non-retweets, sends `retweeted_tweet: null` / `quoted_tweet: null` when absent, and formats `createdAt` like `Wed Nov 18 22:24:23 +0000 2026` (second precision). The sample has no quote tweet, so the quote test builds one inline.

Re-record (the token goes in the Authorization header, never the URL):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"searchTerms":["from:espn"],"queryType":"Latest","maxItems":20}' > apify-real.json
```

then trim to the 5 items and fields above.

`gemini-game.json` and `gemini-search.json` are REAL responses recorded Nov 18 2026 from the public Gemini API (no key), with contracts trimmed to <=6 per event and `description` fields dropped:

```bash
curl -s https://api.gemini.com/v1/prediction-markets/events/NCAAM-2611190200-UCONN-ARI-M
curl -s "https://api.gemini.com/v1/prediction-markets/events?category=Sports&status=active&search=UConn&limit=50"
```
