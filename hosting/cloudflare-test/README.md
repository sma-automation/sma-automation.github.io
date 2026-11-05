# Isolated Cloudflare test release

Preparation lives only on `cloudflare-access-check`. It does not merge PR #74 or
change `website-v1`. The workflow defaults to `pending`: only token verification,
an exact-project lookup, package validation, and CLI preparation run.

The proposed first release creates `sma-customer-website-test` and uploads only the
17 static files (52,105 bytes) built from PR #74 commit
`84cd5c37d7c7336c6adfe9a792776009f453fba3`. Every file is checked against
`release-manifest.json`. The build binds the frontend to
`https://test.sma-automation.com` and site `f931c608-a7fd-40df-9762-574c39301849`.
The resulting Pages hostname is read from Cloudflare, never assumed.

No deployment is approved yet. After the user's explicit approval for this exact
release, set the workflow approval value to `approved-2026-11-05-release1`.
The controller independently checks the same value. A pre-existing project stops
the release; it is never adopted, overwritten, or deleted. If creation succeeds
but uploading fails, the project is retained and requires inspection.

The script uses the existing `CLOUDFLARE_API_TOKEN_READONLY` secret despite its
historical name; the user has changed its Pages permission to Edit. A single
unambiguous token can be extracted from a copied bearer header. Pasted commands
are never executed; API destinations are fixed; credential values and provider
response bodies are never logged. Wrangler is pinned to 4.158.0 and is installed
before credentials enter a step. It runs from the standalone output directory.

This release does not configure domains, IONOS DNS, nameservers, billing,
Supabase, the image endpoint, or a customer's publication status. Static files
will be publicly hosted after approval; the private customer draft remains
private. The future custom-hostname and backend steps require their own review.
