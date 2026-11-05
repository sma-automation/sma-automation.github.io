# Automatische Einrichtung der Kundenwebseite – Pflichtumfang

Stand: 5. November 2026. **In Arbeit, noch nicht für Kunden abgeschlossen.**

Die manuell eingerichtete und getestete Adresse `test.sma-automation.com` beweist
den Hosting-/HTTPS-/Inhaltsweg. Sie beweist keine automatische Einrichtung für
einen neuen Kunden. Die automatische Einrichtung ist ein notwendiger Teil der
Kundenwebseite und kein optionaler späterer Ausbau. Die frühere Abschlussmeldung
in `CUSTOMER_WEBSITE_V1_COMPLETION.md` war insoweit zu weitgehend.

## Fertig vorbereiteter Teil dieses Arbeitsschritts

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
delegierte Vorfahren blockieren die Änderung. Es gibt kein Löschen, kein
Ersetzen einer Zone, keinen Nameserverwechsel und keinen stillen Eingriff in
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

`preflight.mjs` prüft ausschließlich lesend die bekannte Cloudflare-Testadresse
und deren IONOS-CNAME. Ein positiver Preflight bedeutet vorhandene Provider-
Lesbarkeit und passenden Bestandszustand, **keinen** erfolgreichen automatischen
Neuaufbau und keinen Nachweis der Schreibberechtigung.

## Noch notwendiger Anschluss bis zur Abnahme

1. Einmalige sichere Freigabe der Domainverwaltung. Für den IONOS-Testaccount
   wird `IONOS_DNS_API_KEY` als GitHub Actions Repository Secret verwendet.
   Der Eintrag ist vorhanden und sein Format ist jetzt gültig. IONOS lehnt
   jedoch die Anmeldung mit HTTP 401 ab (`IONOS_KEY_REJECTED`). Ein gültiges
   zusammengehöriges Präfix-/Secret-Paar ist weiterhin erforderlich.
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

## Prüfungen

17 Tests für Schlüsselzusammensetzung, Plan-/Zonenbegrenzung, bestehende Root-/Mail-Daten, Konflikte,
parallele Änderungen vor dem Schreiben, verlorene Schreibantworten, Wiederholung,
falsche Providerantworten, Größenlimits und den rein lesenden Preflight bestanden.
Der [echte Preflight-Lauf](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42043729793)
am 5. November 2026, 14:18 UTC, hat die ursprünglichen 15 Adaptertests auch auf
GitHub bestanden. Damals fehlte der IONOS-Eintrag. Nach Freischaltung des
IONOS-API-Produkts und Hinterlegung des Secrets meldete Versuch 3 des Laufs
um 15:28 UTC `IONOS_KEY_FORMAT_INVALID`.

Der [Preflight vom 5. November 2026, 15:32 UTC](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42055976438)
meldete zunächst `IONOS_KEY_SEPARATOR_MISSING`. Nach Korrektur des gespeicherten
Eintrags bestand die Formatprüfung; Versuch 2 um 15:51 UTC wurde von IONOS mit
`IONOS_ACCESS_DENIED` abgewiesen.

Der [genauere Zugangstest um 15:53 UTC](https://github.com/sma-automation/sma-automation.github.io/actions/runs/42059565638)
auf Commit `8e75b82dcba3d9ac805df5612558c35706e13bf7` unterscheidet HTTP 401
(`IONOS_KEY_REJECTED`) von HTTP 403 (`IONOS_ACCESS_FORBIDDEN`). Ergebnis:
alle 17 Adaptertests bestanden, `cloudflare:TEST_DOMAIN_ACTIVE`,
`ionos:IONOS_KEY_REJECTED`, `dnsModified:false`, `ready:false`.
Die HTTP-401-Antwort kommt beim lesenden Abruf der DNS-Zonen; ein fehlender
Trennpunkt ist damit nicht mehr der aktuelle Blocker. Ob der geheime Teil
falsch kopiert wurde, zu einem anderen Präfix gehört oder anderweitig ungültig
ist, lässt sich aus HTTP 401 allein nicht unterscheiden. Kein Schlüsselwert
oder ungefilterter Provider-Antworttext wird ausgegeben.

Noch kein IONOS-Schreibaufruf, kein neuer Host und keine Kundendatenänderung in
diesem Block. Die letzte vollständige lokale Node-Suite bestand mit 416 Tests;
die anschließende Unterscheidung der HTTP-Fehler wurde mit allen 17 betroffenen
DNS-/Preflight-Tests lokal und im echten GitHub-Lauf geprüft.

```sh
node --test tests/website-setup-ionos.test.cjs
node hosting/customer-website-setup/preflight.mjs
```

## Geprüfte Providerverträge

- [IONOS DNS API](https://developer.hosting.ionos.de/docs/dns), OpenAPI 1.0.2:
  `GET /v1/zones`, `GET /v1/zones/{zoneId}`, `POST /v1/zones/{zoneId}/records`.
  Die Dokumentation weist auf mögliche Deaktivierung kollidierender Dienste hin.
- [IONOS Zugangsschlüssel](https://developer.hosting.ionos.de/docs/getstarted):
  `X-API-Key: publicprefix.secret`.
- [Cloudflare Pages Custom Domains](https://developers.cloudflare.com/pages/configuration/custom-domains/):
  Domain zuerst einem Pages-Projekt zuordnen, externe Unteradresse per CNAME;
  Hauptdomain erfordert Cloudflare-Zone/Nameserver.

Alle drei Verträge am 5. November 2026 geprüft.
