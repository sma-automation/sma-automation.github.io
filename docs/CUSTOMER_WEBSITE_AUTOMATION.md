# Automatische SMA-Webadresse

Stand: 5. November 2026, 17:30 UTC. Der vollständige serverseitige Neuaufbau einer SMA-Unteradresse ist erfolgreich. Der Dashboard-Button verwendet denselben besitzergeprüften RPC. Der echte Start erfolgte über diesen RPC mit dem bestehenden Testbesitzer; ein manueller Klick in dessen angemeldeter Browser-Sitzung wird nicht behauptet.

## Echter Durchlauf

- Adresse: `https://seite-4-f931c608.sma-automation.com/`
- Auftrag: `63c7d3e6-edaf-4b2a-8624-b104343128fc`
- Start 17:21:26 UTC; **aktiviert 17:26:03 UTC**.
- Projekt: `sma-site-63c7d3e6edaf4b2a8624b104343128fc`.
- Deployment: `c31e688a-83b2-46b4-9ad8-d8ffe055dfbf`.
- Verlauf: eigenes Pages-Projekt → öffentliches Rendererpaket → Pages-Domain → IONOS-CNAME → öffentliche DNS-Auflösung, Pages-Status `active` und HTTPS-Seitenbindung → bestätigte Adresse.
- Der dauerhafte Auftrag wartete bei `DEPLOYMENT_PENDING` und `HTTPS_PENDING`. Unabhängige weitere Funktionsaufrufe setzten ihn per Cron fort. Kein offener Browser war erforderlich.
- Wiederholter `start` nach Abschluss liefert denselben aktiven Auftrag; weiterhin genau eine Jobzeile.
- Entwurf unverändert privat: Revision 12, MD5 `9fea0bbcbc9a81f0faf26de0ccbefcfe`. Firmenprofil unverändert: Revision 2, MD5 `fd0bb9a29f41592461b15d47eb14ce1f`. Öffentlicher Inhaltsabruf: `NOT_AVAILABLE`.

Die bisher manuell registrierte Adresse `test.sma-automation.com` wurde in der Kundenanzeige durch die neue automatische Adresse ersetzt. Ihr DNS-/Pages-Bestand wurde nicht gelöscht. Hauptdomain, Mail und Nameserver bleiben unverändert. Der neue Host bleibt als nutzbare Adresse des privaten Entwurfs bestehen; er ist keine wegwerfbare Probe.

## Kundenablauf und Reichweite

Dashboard → „Webseite & Domain“ → „Webseite einrichten“ → **„SMA-Webadresse automatisch einrichten“**. Eine vorhandene SMA-Seite ist Voraussetzung. Fortschritt, Wartephasen und Wiederaufnahme überleben das Schließen des Browsers. Veröffentlichung erfolgt ausschließlich durch den bestehenden Editor. Schrift und Layoutklassen bleiben unverändert.

Der Server vergibt `seite-<Kundennummer>-<Seitenkennung>.sma-automation.com`. Aktive Delta-Kunden erhalten damit abgegrenzte Hosts in der von SMA kontrollierten IONOS-Zone. Host, Zone, Projektname und Anbieter-URL sind keine Browserparameter. Der Plattformschlüssel berechtigt Kunden nicht zur Änderung anderer Hosts.

**Diese Lieferung automatisiert SMA-Webadressen.** Eine fremde Wunschdomain wird dadurch nicht gekauft, reserviert oder bei einem beliebigen Registrar eingerichtet. Bestehende WordPress-Verbindung und Domainbesitznachweis bleiben erhalten. Kundeneigene Providerzugänge und Hauptdomains mit Nameservermigration benötigen gesonderte Verbindungen. Ein TXT-Nachweis allein autorisiert keinen DNS-Schreibzugriff.

## Laufzeit und Schutz

- Private Tabellen mit RLS und gesperrten direkten Kundenrechten. Öffentliche RPCs sind Invoker-Wrapper; private Definer haben leeren `search_path`.
- `sma_website_setup_v1(get|start|retry)` prüft aktuelle Besitzerzuordnung, genau einen Kunden, aktiven Delta-Zugang und dessen Seite.
- Ein Job pro Kunde/Seite/Hostname. Fünfminütige Lease mit zufälliger ID. Alte/abgelaufene Leases aktivieren keine Ergebnisse. Besitzer und Zugang werden bei Claim und Abschluss erneut geprüft.
- Pages-Projekt trägt eine zufällige Eigentumsmarkierung. Exakte Projekt-/Deployment-IDs verhindern Fremdübernahme. Verlorene Antworten werden durch Lesen und Wiederverwenden des eigenen Zustands aufgefangen.
- Das Rendererpaket enthält nur die erlaubten öffentlichen Dateien und die Seitenbindung, keine Kundendaten oder Anmeldesitzung.
- IONOS schreibt ausschließlich additive CNAME-Einträge. Fremde, doppelte, deaktivierte Einträge, Wildcards und delegierte Bereiche blockieren. Kein Ersetzen vorhandener Dienste, keine Nameservermigration. Gleichzeitige fremde Änderungen außerhalb SMA bleiben eine Betriebsgrenze, weil der IONOS-POST keinen hier belegten Compare-and-swap-Vertrag bietet.
- `pg_net` startet nach Transaktionsabschluss; `pg_cron` setzt fällige Jobs minütlich fort. Backoff bis fünf Minuten, maximal 120 Versuche pro Phase. Status enthält feste Codes statt Geheimnissen oder Providerantworten.
- Aktivierung erst nach passendem Provider-CNAME, öffentlicher Auflösung, aktiver Pages-Domain und HTTPS-Abruf der exakten Seitenbindung. Ausstehende Pages-Validierung wird nach sichtbarem DNS begrenzt erneut angestoßen.
- Bild-Origin und Browserabruf öffentlicher Inhalte prüfen die aktive Adressregistrierung und aktuelle Besitzer-/Zugangszuordnung. Widerruf oder Besitzerwechsel sperrt diese Browserwege. Veröffentlichung kann unabhängig im Editor zurückgenommen werden. Physische Hostingressourcen werden bei Zugangssperre nicht automatisch gelöscht.

## Zugangsdaten und Betrieb

Der [Bootstrap-Lauf, Versuch 2](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42073500029) übertrug bestehende GitHub Secrets direkt per HTTPS in Supabase Vault. Der Server prüfte GitHubs RS256-Signatur, festen Issuer/Audience, Repository-ID, Branch, Workflowpfad, Zeitfenster und einmalig freigegebenen Commit. GitHubs beobachtetes Subject enthält unveränderliche IDs (`sma-automation@329573094/...@1371569809`).

IONOS-/Cloudflare-Zugangsdaten liegen verschlüsselt in Vault. Ein separates zufälliges Token authentifiziert den Worker. Kunden erhalten keinen dieser Werte. Der einmalige Bootstrap-Workflow wurde nach Erfolg entfernt; Lauf und Quellstand bleiben in der GitHub-Historie. Bei vorhandener Konfiguration wird eine erneute Installation abgewiesen.

**Betriebsgrenzen:** Der vorhandene Cloudflare-Token wurde mit Ablaufdatum **12. November 2026** eingerichtet. Für weitere Neueinrichtungen muss der Betreiber ihn vorher erneuern. Bestehende statische Seiten/DNS-Einträge werden durch Ablauf nicht automatisch gelöscht. Die Projektgrenzen des kostenlosen Pages-Kontos gelten weiterhin. Der bisherige öffentliche Renderer bleibt auf `noindex`; SEO-Freigabe ist eine separate Veröffentlichungsentscheidung.

## Prüfungen

- 437 Node-Tests erfolgreich, einschließlich IONOS, Pages-Eigentumsprüfung, verlorener Antworten, OIDC und dynamischer Bild-Origin-Sperren.
- 41 SQL-Vertragsprüfungen: Delta/Besitzer, private Entwürfe, wiederholter Start, Leases, Retry, Aktivierung, Vault-ACL, Origin-Widerruf und kein vom Kunden gewählter Host.
- DOM-Prüfungen für Start, Doppelklick-Sperre, Fortschritt, Retry, Besitzerwechsel und Teardown. Bestehende neue-Domain- und Webseitenübersicht-Prüfungen bestanden.
- Bestehende SQL-Suiten für Webseiten, Firmendaten, Bilder, Design und bestätigte Adressen bestanden.
- Security-Advisors: keine neue Warnung. Die drei privaten Tabellen melden erwartungsgemäß RLS ohne direkte Kunden-Policies.
- Frühere echte [IONOS-Schreibprobe](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42066886980): CNAME angelegt, ohne Duplikat wiederverwendet, exakt eigene ID entfernt, Löschung bestätigt. Getrennt vom jetzt behaltenen Kundenhost.

```sh
node --test tests/*.test.cjs
node tests/run-website-setup-sql.mjs
node tests/run-website-setup-dom.mjs
node tests/run-new-website-domain-dom.mjs
node tests/run-customer-website-dashboard-dom.mjs
node tests/run-customer-websites-sql.mjs
```

Primärquellen: [IONOS OpenAPI](https://developer.hosting.ionos.com/assets/kms-swagger-specs/dns.yaml), [Pages Direct Upload](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/create/), [Pages Validierung](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/edit/), [GitHub OIDC](https://docs.github.com/en/actions/reference/security/oidc), [Supabase Cron](https://supabase.com/docs/guides/functions/schedule-functions).
