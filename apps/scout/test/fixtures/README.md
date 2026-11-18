# Fixtures

`apify-kaito.json` is SYNTHETIC, hand-written from the actor's documented output shape (no APIFY_TOKEN was available). Tweet ids are valid snowflakes matching each `createdAt`. The nested `quoted_tweet` object is not documented by the actor.

Re-record with a real token once available:

```bash
curl -s -X POST "https://api.apify.com/v2/acts/kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest/run-sync-get-dataset-items?token=$APIFY_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"searchTerms":["from:espn"],"queryType":"Latest","maxItems":20}' > apps/scout/test/fixtures/apify-kaito.json
```
