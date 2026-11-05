# Bestätigte Kundenadresse im Webseiteneditor

Stand: 5. November 2026. Die bestätigte Adresse wird dem bestehenden privaten Webseitenstand zugeordnet. Der Editor zeigt sie unter „Sichtbarkeit“. Bei einer veröffentlichten Seite öffnet der öffentliche Link die bestätigte Adresse; ohne Zuordnung bleibt die bisherige SMA-Adresse erhalten.

## Daten- und Zugriffsgrenze

`supabase/sql/customer-website-addresses.sql` legt ein administrativ gepflegtes Register in `sma_private` an. Pro Kunde und Seite ist genau ein Host möglich; Hostnamen sind global eindeutig und streng validiert. Der bestätigte Datensatz enthält Besitzer, Seite, Zeitpunkt und internen Nachweis. Es gibt keine Kunden-Schreibschnittstelle und keine direkten Tabellenrechte für `anon`, `authenticated` oder `service_role`; RLS ist aktiv und verweigert ohne Policy jeden direkten Kundenzugriff.

Die bestehende `sma_customer_website_v1`-RPC führt zuerst unverändert alle Eigentümer-, Zugangs-, Revisions-, Bild- und Veröffentlichungsprüfungen aus. Nur erfolgreiche Antworten erhalten zusätzlich `custom_domain` mit `site_id`, `hostname`, `verified_at` oder `null`. Der lesende Helper kontrolliert aktuellen Besitzer, einzelne Kundenzuordnung, aktiven Delta-/Demo-Zugang, Seitenbindung, Nachweiszeitpunkt und Entzug. Interne Nachweise und Kunden-/Benutzerkennungen werden nicht ausgegeben. Die kanonische `website_url` bleibt kompatibel mit bisherigen Clients und privaten Vorschauen.

Der Editor akzeptiert nur eine exakt zur geladenen Seite gehörende, gültige HTTPS-Hostzuordnung. Bei Abmeldung, Kontowechsel, Zugriffsentzug und fehlgeschlagener Aktualisierung werden Adresse und alter öffentlicher Link entfernt. Bei zurückgenommener Zuordnung wird wieder die kanonische SMA-Adresse verwendet. Es gibt keine automatische Veröffentlichung.

**Dieses Register dokumentiert bestätigte Bereitstellungen für die Besitzeranzeige. Es richtet keine Domains ein und schaltet bestehende Hostingbindungen oder Bild-Origins nicht ab.** Eine automatische Mehrkunden-Einrichtung mit DNS-/HTTPS-Prüfung und gemeinsamem Entzugslebenszyklus bleibt offen. Bei Betriebsänderungen müssen Cloudflare-Bindung, DNS und Bild-Origin separat berücksichtigt werden. `revoked_at` allein ist keine Hostingabschaltung.

## Bereitstellung und bestätigter Zustand

Die Migration `customer_website_confirmed_addresses_v1` wurde auf dem bestehenden Supabase-Projekt angewendet. Anschließend wurde ausschließlich die zuvor über HTTPS und mit sichtbaren Inhalten geprüfte Adresse `test.sma-automation.com` administrativ registriert. Der Schreibvorgang war an Besitzer, Seiten-ID, Revision 12, Originalentwurf-Prüfsumme und leere öffentliche Snapshots gebunden.

Ein anschließender lesender Aufruf mit der Datenbankrolle `authenticated` und den Claims des bestehenden Testbesitzers ergab: bestätigte Adresse vorhanden, Revision **12**, Firmenprofilrevision **2**, `published=false`, `publicly_available=false`, kanonischer Link unverändert. Die öffentliche RPC liefert weiterhin `NOT_AVAILABLE`. Dies ist eine echte Datenbank-/Rollenprüfung, kein erneuter angemeldeter Browserdurchlauf. Der Entwurf wurde weder geschrieben noch veröffentlicht.

Die bereits aktive Bildfunktion Version 2 und der abgeschlossene öffentliche Domain-Test werden in [CUSTOMER_WEBSITE_CUSTOM_DOMAIN_E2E.md](CUSTOMER_WEBSITE_CUSTOM_DOMAIN_E2E.md) dokumentiert. Die Dateien ihrer nicht geheimen Origin-Konfiguration werden in PR #74 konsolidiert. Das bestehende Cloudflare-Paket bleibt unverändert; der neue Editor wird über den bisherigen SMA-Webseitenzweig ausgeliefert.

## Prüfungen

- **399 Node-Tests bestanden**, einschließlich ungültiger Hosts, fremder Seiten, unerlaubter Zusatzfelder, Zugriffsverlust und Rückwärtskompatibilität.
- SQL-/Rollenprüfungen im PostgreSQL-kompatiblen PGlite: eigene und fremde Kunden, keine direkten Rechte, keine anonymen Helperrechte, eindeutige und gültige Hosts, zukünftiger Nachweis, Entzug, Besitzerwechsel sowie weiterhin explizite Veröffentlichung/Offlineschaltung. Alle Fixtures zurückgerollt. Bestehende Webseiten-, Firmenprofil-, Gestaltungs- und Bild-SQL-Prüfungen ebenfalls bestanden.
- DOM-Prüfungen: bestätigte private Adresse, öffentlicher Custom-Link, kanonischer Rückfall, Entzug, Netzfehler, Zugangsverlust und verspätete Antwort bei Kontowechsel. Nur lesende Anfragen. Bestehender Editor-, Bild-, Vorschau-Refresh- und Domainrenderer ebenfalls geprüft.
- Sicherheitsadvisor nach Migration: neues Register mit RLS ohne Policies gemeldet; dies ist hier der beabsichtigte vollständige Ausschluss direkter Kunden-Tabellenzugriffe. Zugriff erfolgt nur über den begrenzten Besitzer-Helper.

Reproduzieren:

```sh
node --test tests/*.test.cjs
node tests/run-customer-websites-sql.mjs
node tests/run-customer-website-address-dom.mjs
node tests/run-customer-website-dom.mjs
node tests/run-customer-website-images-dom.mjs
node tests/run-customer-website-refresh-dom.mjs
node tests/run-customer-website-domain-dom.mjs
git diff --check
```

## Rückbau

Frontenddateien auf den vorherigen Stand zurückstellen. Für einen reinen Anzeigerückbau kann die öffentliche RPC wieder ausschließlich `sma_private.customer_website_request_v1(p_action,p_input)` zurückgeben; das Register kann zunächst erhalten bleiben. Weder Rückbau noch Widerruf eines Registereintrags dürfen als DNS-/Hostingabschaltung verstanden werden. Bestehende Webseiten-/Firmeninhalte und Bilddateien sind nicht Bestandteil dieses Rückbaus.
