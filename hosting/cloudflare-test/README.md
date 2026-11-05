# Isolated Cloudflare test release

## Released on 2026-11-05

The user explicitly approved creating the separate project and uploading the exact
17-file package. The release succeeded in [GitHub Actions run 42026403715](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42026403715).

- Project: `sma-customer-website-test`
- Returned hosting URL: https://sma-customer-website-test.pages.dev
- Source: PR #74 commit `84cd5c37d7c7336c6adfe9a792776009f453fba3`
- Package: 17 files, 52,105 bytes, checked against `release-manifest.json`
- Frontend binding: `https://test.sma-automation.com`, site `f931c608-a7fd-40df-9762-574c39301849`
- Permission/manifest/approval tests: 10 passed before the upload.

The deployment workflow has now been replaced by public GET verification only.
It receives no credentials and cannot create or update Cloudflare resources.
The original deployment controller is retained for audit, but no automatic
workflow invokes it. Existing projects are never overwritten by that controller.

The local work environment received Cloudflare HTTP 403 / error 1010 during the
public check; public file and header verification is being checked from GitHub.

No custom domain, IONOS DNS, nameserver, billing, Supabase, image endpoint, or
customer publication status was changed. The static package is deployed; the
private customer draft remains private. `website-v1` and PR #74 are unchanged.
The frontend intentionally rejects the Pages hostname as a customer-site origin;
it is prepared for the later approved `test.sma-automation.com` binding.
