# Automatische Einrichtung der Kundenwebseite – Pflichtumfang

Stand: 5. November 2026. **In Arbeit, noch nicht für Kunden abgeschlossen.**

Die manuell eingerichtete und getestete Adresse `test.sma-automation.com` beweist
den Hosting-/HTTPS-/Inhaltsweg. Sie beweist keine automatische Einrichtung für
einen neuen Kunden. Die automatische Einrichtung ist ein notwendiger Teil der
Kundenwebseite und kein optionaler späterer Ausbau. Die frühere Abschlussmeldung
in `CUSTOMER_WEBSITE_V1_COMPLETION.md` war insoweit zu weitgehend.

## Geprüfter IONOS-Anschluss

`hosting/customer-website-setup/ionos.mjs` implementiert den serverseitigen
IONOS-DNS-Anschluss. Er akzeptiert nur einen konkreten CNAME-Auftrag für eine
Unteradresse einer zuvor serverseitig freigegebenen Zone und ein Cloudflare-
Pages-Ziel. Die DNS-Zone wird über den autorisierten IONOS-Account ermittelt,
nicht über einen vom Browser gelieferten API-Pfad.

Ein passender vorhandener Eintrag wird wiederverwendet. Ein neuer Eintrag wird
additiv erzeugt und anschließend aus der DNS-Verwaltung zurückgelesen. Nach
verlorener Schreibantwort bleibt das Ergebnis unbestätigt; der nächste Lauf
liest zuerst den tatsächlichen Stand, statt nochmals blind zu schreiben.

Fremde, doppelte oder deaktivierte Einträge, belegte Unterbäume, Wildcards und
delegierte Vorfahren blockieren die Änderung. Der CNAME-Adapter bietet kein
Löschen, kein Ersetzen einer Zone, keinen Nameserverwechsel und keinen stillen Eingriff in
bestehende Mail-/Webdienste. Die IONOS-API bietet für diesen POST keinen hier
belegten bedingten Schreibvertrag: Fremde gleichzeitige Änderungen zwischen
letztem Lesen und Schreiben bleiben eine Betriebsgrenze. Ein zukünftiger
Auftragsdienst muss SMA-Aufträge pro Host mit einer dauerhaften Sperre
serialisieren; der Adapter allein ersetzt diese Sperre nicht.

Fehlermeldungen enthalten feste Statuscodes, keine Zugangsdaten oder fremde
Providerantworten. Requests gehen nur an den fest vorgegebenen IONOS-API-Host,
ohne Redirects, mit Zeit- und Antwortgrößenlimit. Zugangsdaten bleiben in der
geschützten Laufzeit. Der Adapter ist nicht mit dem Browser verbunden.

Die Schlüsselprüfung toleriert kopierte Rand-Leerzeichen/Zeilenumbrüche vor,
nach und zwischen den vollständigen Teilen `Präfix.geheimerSchlüssel`.
Innerhalb der Teile wird nichts verändert; fehlende Teile oder Trennpunkte
werden nicht geraten. Feste Fehlercodes unterscheiden diese Eingabefehler,
ohne den Schlüssel, seine Teile oder Providerantworten auszugeben.

Alternativ kann der Aufrufer den öffentlichen Präfix explizit separat
konfigurieren (`publicPrefix`). Dann darf der geschützte Wert nur den geheimen
Teil enthalten; der Adapter setzt genau diese beiden Werte zusammen. Ein
vollständiges Paar bleibt zulässig, muss aber zum konfigurierten Präfix passen.
Ein öffentlicher Präfix allein wird als `IONOS_SECRET_REQUIRED` abgewiesen.
Der Test-Workflow konfiguriert den vom Nutzer gezeigten öffentlichen Präfix des
Schlüssels `SMA-DNS-Automatisierung-2` als `IONOS_DNS_API_PREFIX`; der geheime
Wert bleibt ausschließlich im GitHub Secret. Es werden keine Präfixe geraten
und keine alternativen Schlüssel durchprobiert.

`preflight.mjs` prüft ausschließlich lesend die bekannte Cloudflare-Testadresse
und deren IONOS-CNAME. Ein positiver Preflight bedeutet vorhandene Provider-
Lesbarkeit und passenden Bestandszustand, **keinen** erfolgreichen automatischen
Neuaufbau und keinen Nachweis der Schreibberechtigung.

## Noch notwendiger Anschluss bis zur Abnahme

1. Einmalige sichere Freigabe der Domainverwaltung. Für den IONOS-Testaccount
   wird `IONOS_DNS_API_KEY` als GitHub Actions Repository Secret verwendet.
   Der geheime Wert wurde korrekt hinterlegt. Der Test-Workflow ergänzt den
   explizit konfigurierten öffentlichen Präfix. Lesezugang und tatsächliches
   Anlegen eines temporären CNAME sind erfolgreich nachgewiesen; dieser
   Zugang ist kein aktueller Blocker mehr. Für den Mehrkundenbetrieb muss die
   Verbindung weiterhin einem berechtigten Besitzer und dessen Zone zugeordnet
   und sicher in der Auftragslaufzeit verfügbar gemacht werden.
   Ein Cloudflare-Pages-Token ersetzt diesen IONOS-Zugang nicht. Der vorhandene
   temporäre Cloudflare-Token läuft laut Einrichtung am 12. November 2026 ab;
   der Dauerbetrieb braucht einen betreuten Ablauf-/Erneuerungsprozess.
2. Besitzergebundener dauerhafter Auftrag aus dem Dashboard mit bestehender
   Delta-/Zugangsprüfung, Domainfreigabe, exklusiver Hostzuordnung und
   Wiederaufnahme. Ein Domainwunsch allein autorisiert keinen Providerzugriff.
   Kundeneigene Anbieter müssen einmal durch den Berechtigten verbunden werden.
3. Automatischer Hosting-Aufbau, isoliertes veröffentlichtes Rendererpaket,
   Pages-Domainanmeldung und dann DNS-Einrichtung über den verbundenen Anbieter.
   Die bisherigen Cloudflare-Skripte sind ausdrücklich auf einen einzelnen
   Testhost begrenzt und werden nicht als Mehrkunden-Provisionierer ausgegeben.
4. Unabhängige CNAME-/HTTPS-/Seitenzuordnungsprüfung vor Aktivierung der Adresse.
   Passende dynamische Bild-Origin-Freigabe und gemeinsamer Entzugslebenszyklus.
   Eine Zeile in der bisherigen Adressregistrierung deaktiviert keinen Host.
5. Ein echter vollständiger Test einschließlich Unterbrechung/Wiederaufnahme,
   falschem Besitzer, Konflikt und anschließendem Rückbau. Erst danach wird der
   Kundenbutton als betriebsbereit ausgeliefert. Inhalte bleiben bis zur
   ausdrücklichen Veröffentlichung privat.

Kein Kauf einer Wunschdomain und keine kostenpflichtige Tarifänderung sind in
diesem Schritt enthalten. Für Hauptdomains ohne Unteradresse verlangt Cloudflare
Pages eine Cloudflare-Zone/Nameserver-Konfiguration. Der hier vorbereitete
CNAME-Anschluss migriert keine Hauptdomain. Weitere Anbieter benötigen eigene
geprüfte Verbindungen, keine pauschale Zusage für beliebige Registrare.

## Echte Nachweise vom 5. November 2026

**IONOS-Zugang und DNS-Schreibfunktion sind geprüft. Der vollständige
Kundenautomatismus ist weiterhin offen.**

- [Erster erfolgreicher Zugangstest, 16:34 UTC](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42065758134),
  Commit `e2805bdcf50904b8a3ba8bb182b7bcf947ffb0b7`: alle 22 Tests bestanden,
  `cloudflare:TEST_DOMAIN_ACTIVE`, `ionos:TEST_CNAME_CONFIRMED`,
  `dnsModified:false`, `ready:true`.
- [Echter Schreibtest, 16:40 UTC](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42066886980),
  Commit `18c43b9be4b341972ab7e5ad11c9317ca93ea120`: alle 28 Adapter-/Probe-Tests
  bestanden, `status:DNS_WRITE_CHECK_PASSED`, `created:true`,
  `repeatedWithoutDuplicate:true`, `removed:true`.
- [Erneuter Bestandscheck desselben Commits, 16:40 UTC](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42066886897):
  Cloudflare-Testadresse weiterhin aktiv, IONOS-Test-CNAME weiterhin passend,
  alle 22 Preflight-/Adaptertests bestanden.

Der Schreibtest hat genau
`setup-check-42066886980-1.sma-automation.com` mit Ziel
`sma-customer-website-test.pages.dev` angelegt. Eine Wiederholung hat denselben
Datensatz verwendet, ohne einen zweiten anzulegen. Anschließend wurde die im
Lauf zurückgelesene Datensatz-ID entfernt und das Fehlen des Eintrags über die
IONOS-API bestätigt. Es wurde keine neue Cloudflare-Domain angemeldet und keine
Kundenwebseite veröffentlicht. Der bestehende Testhost blieb erhalten.

`write-probe.mjs` ist ein separater Test mit fest begrenzter Zone und einem aus
GitHub-Laufnummer und Versuch erzeugten Hostnamen. Vorhandene Einträge blockieren
den Test. Nur die konkret erzeugte ID mit unverändertem Ziel wird entfernt;
Änderungen, Duplikate oder ein unbestätigtes Anlegen führen zu einem klaren
Aufräum-/Prüfbedarf statt zum Löschen einer geratenen ID. Der Workflow
`customer-domain-dns-writecheck.yml` serialisiert diese Tests und läuft nur bei
Änderungen an seinem eigenen Workflow-/Probe-/Testcode auf
`customer-domain-automation`. Der normale Preflight bleibt vollständig lesend.

Die 28 lokalen und GitHub-Tests decken Schlüsselzusammensetzung, sichere
Zonenbegrenzung, unveränderte Root-/Mail-Daten im Modell, Konflikte, Wiederholung,
verlorene Antworten, das dokumentierte Antwortformat und begrenztes Entfernen
des temporären Eintrags ab. Die letzte vollständige lokale Node-Suite vor
diesen Erweiterungen bestand mit 416 Tests; nach den Erweiterungen wurden die
28 betroffenen Tests ausgeführt. `git diff --check` ist sauber.

### Behobene Hindernisse

Die früheren Läufe scheiterten an fehlenden Schlüsselbestandteilen bzw. HTTP
401. Nach Speicherung ausschließlich des geheimen Teils wurde die Anmeldung
akzeptiert; [Versuch 2 um 16:29 UTC](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42064167734)
erreichte die DNS-Zonen und scheiterte noch an `INVALID_RECORD_RESPONSE`.
Die Antwortprüfung wurde mit dem öffentlichen IONOS-OpenAPI-Schema abgeglichen:
Record-IDs sind undurchsichtige Zeichenketten ohne garantierte UUID-Version;
`disabled` ist optional mit Standard `false`. Der Parser berücksichtigt beides,
weist explizit ungültige Typen weiterhin ab und liefert nur feste Fehlercodes.
Der erfolgreiche Zugangstest bestätigt die Korrektur mit echten Daten.

```sh
node --test tests/website-setup-ionos.test.cjs tests/website-setup-write-probe.test.cjs
node hosting/customer-website-setup/preflight.mjs
```

## Geprüfte Providerverträge

- [IONOS DNS API](https://developer.hosting.ionos.de/docs/dns), OpenAPI 1.0.2:
  `GET /v1/zones`, `GET /v1/zones/{zoneId}`, `POST /v1/zones/{zoneId}/records`.
  Der temporäre Schreibtest nutzt zusätzlich das dokumentierte
  `DELETE /v1/zones/{zoneId}/records/{recordId}` für seine eigene erzeugte ID.
  [OpenAPI-Schema](https://developer.hosting.ionos.com/assets/kms-swagger-specs/dns.yaml):
  `record-response.id` ist eine Zeichenkette, `disabled` hat Standard `false`.
  Die Dokumentation weist auf mögliche Deaktivierung kollidierender Dienste hin.
- [IONOS Zugangsschlüssel](https://developer.hosting.ionos.de/docs/getstarted):
  `X-API-Key: publicprefix.secret`.
- [Cloudflare Pages Custom Domains](https://developers.cloudflare.com/pages/configuration/custom-domains/):
  Domain zuerst einem Pages-Projekt zuordnen, externe Unteradresse per CNAME;
  Hauptdomain erfordert Cloudflare-Zone/Nameserver.

Alle drei Verträge am 5. November 2026 geprüft.
