# Scout accuracy eval

`labelled.json` holds hand-labelled tweets. The eval runs the read and match
stages on them (no DB writes) and reports how often each pick matches the
expected Gemini contract.

Each entry:

```json
{
  "tweetId": "1858000000000000000",
  "tweetedAt": "2026-11-18T12:00:00.000Z",
  "text": "Lakers win tonight, lock it in",
  "expected": [{ "instrumentSymbol": "GEMI-NBA-2611190200-LAL-CHA-M-LAL", "side": "yes" }]
}
```

- `expected` is the list of correct picks. An empty array means the post is not a prediction.
- `side` is `"yes"` or `"no"`, following the line rule.
- A pick is correct when a matched result has the same `instrumentSymbol` and `side`.

Run it (calls Grok and Gemini, so it costs API credits):

```sh
pnpm --filter @copayme/scout eval
```

It prints accuracy per bet type, false positives, and misses. It exits 1 when
`win` accuracy is below 80%.
