# Test hostname verified — 2026-11-05

## Completed

https://test.sma-automation.com/ is connected to the isolated Cloudflare Pages project `sma-customer-website-test`. The user saved the agreed IONOS CNAME and supplied the success screen. Cloudflare domain, validation and verification statuses are now all `active`.

| DNS field | Saved value |
| --- | --- |
| Record type | `CNAME` |
| Hostname | `test` |
| Target | `sma-customer-website-test.pages.dev` |
| TTL | 1 hour / 3600 seconds |

Google and Cloudflare public DNS both returned the exact CNAME. Root NS remain `ns1070.ui-dns.com`, `ns1116.ui-dns.biz`, `ns1017.ui-dns.org`, `ns1097.ui-dns.de`; root A records remain `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; root MX remain `10 mx00.ionos.de` and `10 mx01.ionos.de`. No root, mail or nameserver changes were performed.

## Live verification

[Custom-host verification run 42031316412](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42031316412), latest attempt, succeeded on 5 November 2026 at 14:02 Vienna time:

- Cloudflare status: domain `active`, validation `active`, verification `active`.
- Valid HTTPS serves all 16 public files with exact release SHA-256 hashes. The 17th uploaded file (`_headers`) is verified by the applied response headers.
- Cache-Control, noindex, nosniff, Referrer-Policy, X-Frame-Options and CSP headers match the prepared package.
- An unknown route returns the exact prepared 404 page, without SPA fallback.
- The public read RPC for the assigned site returns `{ "ok": false, "code": "NOT_AVAILABLE" }`; CORS permits the custom origin.
- A real browser visit to the custom hostname showed `Diese Webseite ist derzeit nicht verfügbar.` This is the expected private-draft boundary, not a DNS/HTTPS failure.

The initial activation check timed out while Cloudflare still reported `CNAME record not set`. The DNS record was independently confirmed. A guarded validation-refresh workflow was prepared, but the domain had become active by execution time, so its guard performed no PATCH. No additional DNS/CAA/security changes were needed. The one-time refresh workflow no longer runs automatically on pushes.

## Scope and remaining work

The deployed static package is unchanged: PR #74 source commit `84cd5c37d7c7336c6adfe9a792776009f453fba3`, 17 files, 52,105 bytes. The private SHK site `f931c608-a7fd-40df-9762-574c39301849` has not been published. `website-v1`, PR #74, billing and backend configuration remain unchanged.

The domain/HTTPS and private-page checks are complete. A positive customer-content and own-image test is still separate: review and explicitly approve the test content, prepare the image endpoint/origin configuration if required, then temporarily publish only that test content and return it offline after verification. Do not imply that this positive publishing/image test has already passed.

## Sources

- [Binding run](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42028871010)
- [Active-status run](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42032114920)
- [Guarded refresh run (no-op because already active)](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42032115002)
- [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Cloudflare domain-validation API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/edit/)
- [IONOS CNAME setup](https://www.ionos.de/hilfe/domains/cname-records-fuer-subdomains-konfigurieren/cname-record-fuer-eine-bestehende-subdomain-konfigurieren/)
