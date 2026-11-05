# Test hostname setup — 2026-11-05

The user requested continuing with the announced `test.sma-automation.com` connection after the isolated deployment. The domain was attached only to the existing `sma-customer-website-test` Cloudflare Pages project. [Binding run](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42028871010) succeeded.

Cloudflare returned `initializing` for domain/validation and `pending` for verification. No DNS change was made. The workflow now calls status-only mode; it can be rerun after the external DNS update.

## DNS change still required at IONOS

| Field | Exact value |
| --- | --- |
| Domain whose DNS settings to open | `sma-automation.com` |
| Record type | `CNAME` |
| Hostname | `test` |
| Target / Zeigt auf | `sma-customer-website-test.pages.dev` |
| TTL | Keep IONOS default (normally 1 hour) |

Public DNS checks immediately before binding returned NXDOMAIN for `test` A/AAAA/CNAME/TXT. Root NS still point to `ns1070.ui-dns.com`, `ns1116.ui-dns.biz`, `ns1017.ui-dns.org`, `ns1097.ui-dns.de`; root A records are `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; root MX remain `10 mx00.ionos.de` and `10 mx01.ionos.de`. Root CAA query returned no records.

Do not replace the root A records, repository CNAME, mail records, or nameservers. The DNS plugin search did not provide an IONOS connector, so the user must enter the one CNAME in their own IONOS browser session. No additional domain purchase, hosting subscription, or DNS-provider migration is needed for this configured test approach.

After the user saves the CNAME, check public DNS and rerun the status-only domain workflow. Verify active domain status, HTTPS and the prepared static package at the custom hostname. The private customer draft must remain unavailable; no positive customer-content publication was authorized in this step. The image endpoint and other backend changes remain separate.

## Sources

- [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Cloudflare add-domain API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/create/)
- [IONOS CNAME setup](https://www.ionos.de/hilfe/domains/cname-records-fuer-subdomains-konfigurieren/cname-record-fuer-eine-bestehende-subdomain-konfigurieren/)
