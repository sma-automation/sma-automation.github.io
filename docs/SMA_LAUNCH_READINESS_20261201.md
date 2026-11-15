# SMA – Startcheck zum 1. Dezember 2026 (rein lesend)

Stand: **15. November 2026**, Österreich. Dieser Bericht ist eine
Momentaufnahme und **keine** automatisierte Kunden- oder Uploadfreigabe.

## Ziel

Der wiederholbare SQL-Check
`supabase/sql/launch-readiness-readonly.sql` fasst nur Zahlen und
Sperrstatus aus den vorhandenen SMA-Tabellen zusammen. Er ist für
berechtigte technische Betreiber bestimmt und wird **nicht** als
öffentliches Browser-RPC angeboten. Er verlangt keine Anmeldedaten,
schreibt nichts und macht keinen Provider- oder Zahlungsaufruf.

Die Ausgabe enthält absichtlich weder Kundennamen/Kunden-IDs,
E-Mail-Adressen, Medienbytes, Dateipfade noch Tokens. **Eine Anzahl
gilt nie als Beweis für den unveränderten Freigabe-Fingerprint oder
einen erfolgreich veröffentlichten Beitrag.**

## Einstieg nach der E-Mail-Bestätigung (15.11.2026)

Bei ausstehender E-Mail-Bestätigung kann der Kunde auf der Anmeldeseite über
„Bestätigungsmail fehlt?“ einen neuen Link anfordern. Nach einer Registrierung
oder einem Anmeldeversuch mit unbestätigter Adresse ist diese bereits
eingetragen. Bei einem abgelaufenen Link ohne erkennbaren Zweck stehen
Registrierungsbestätigung und Passwort-Wiederherstellung zur Auswahl.
Der vorhandene Browser-Test `tests/run-customer-entry.mjs` prüft beide Wege
mit simuliertem Mailversand.

Der veröffentlichte Website-Workflow `JHkHPTTL2ttfCMMg` (Version
`971b74ee-6ef0-4fff-8eaf-0f22876dfbba`) gibt für ein neues bestätigtes
Profil HTTP 403 zurück. Der Registrierungs-Trigger legt es ohne Paket,
Zahlung, Demo und n8n-Zuordnung an. Der veröffentlichte Kundenassistent
`GHBsYQcyt0JLFvRP` verwendet für seine bestehende Paketseite einen aktiven
n8n-Kundenzugang mit eigenem Zugangstoken.

Nach einer 403-Antwort im regulären Dashboard prüft SMA, ob das angemeldete
Konto für eine erste Paketvormerkung berechtigt ist. Nur ein eindeutig
zugeordnetes und E-Mail-bestätigtes Neuprofil ohne Zugang oder Paket erhält
die Auswahl. Sie bleibt nach der geprüften Erstzuordnung erreichbar. Alpha, Beta und Delta lassen sich
unverbindlich vormerken und beim nächsten Besuch ändern. Die Vormerkung
wird getrennt vom Kundenpaket gespeichert. Bei Änderungen in zwei Fenstern
zeigt SMA die aktuelle Auswahl an. Die Tests verwenden ausschließlich
synthetische Konten und simulierte Dienstantworten.

### Erste Kontozuordnung im Pilotbetrieb

Jede Vormerkung erhält eine eigene dauerhafte n8n-Kundenkennung. Der Betreiber
ordnet das bestätigte Website-Konto einmalig in der vorhandenen Datentabelle
`SMA_Kunden` zu. Dafür genügen die private n8n-Tabellenansicht und der
Supabase-SQL-Editor. Nach dem erneuten Öffnen der Vormerkung sieht der Kunde
„Dein SMA-Kundenkonto ist zugeordnet“ und kann seine Auswahl weiter ändern.

1. Offene Vormerkungen im SQL-Editor abrufen. Ein leeres Ergebnis beendet den Durchlauf.

   ```sql
   select n8n_ref, kunde_email from sma_private.onboarding_n8n_accounts_v1
   where n8n_row_id is null order by customer_id;
   ```

2. In `SMA_Kunden` nach der Kennung und separat nach der E-Mail-Adresse suchen.
   Auch abweichende Großschreibung und Leerzeichen bei der Adresse prüfen.
   Die Zuordnung je Vormerkung von einer Person bearbeiten. Bei null Treffern
   genau eine Zeile mit der reservierten Kennung und der exakt angegebenen
   E-Mail-Adresse anlegen. `zugang_aktiv`, `demo_delta_aktiv` und
   `zahlung_bestaetigt` auf **AUS** setzen. Paket, Zugangstoken, Zugangslink
   und Dienstzugänge leer lassen. Bei einer Unterbrechung wieder mit der Suche
   beginnen. Ein vorhandenes Konto mit anderer Kennung oder Adresse oder mehrere
   Treffer erfordern einen manuellen Abgleich.
3. Die gespeicherte n8n-Zeile erneut öffnen. Die interne numerische `id`, die
   Kennung, die E-Mail-Adresse und die vier Statusfelder direkt aus dieser
   Ansicht ablesen. Im Projektverzeichnis den folgenden lokalen Befehl starten
   und die Werte eingeben. Das Hilfsprogramm gibt den fertigen SQL-Aufruf aus
   und baut E-Mail-Adressen mit Sonderzeichen korrekt ein.

   ```sh
   node n8n/confirm-onboarding-row.cjs
   ```

   Den ausgegebenen Aufruf im privaten Supabase-SQL-Editor ausführen. Er enthält
   die abgelesenen Angaben. Die Datenbank gleicht diese mit der Vormerkung ab.

4. `LINKED` bestätigt die erste Zuordnung, `ALREADY_LINKED` die Wiederholung
   mit derselben Zeile. Bei allen anderen Ergebnissen Kennung, Adresse,
   Eindeutigkeit und Status erneut prüfen. Beide Konten bleiben inaktiv.
   Bei einem späteren Adresswechsel müssen Website und n8n erneut abgeglichen werden.

### Paketbuchung im betreuten Pilotbetrieb

Für das zugeordnete Website-Konto kann der Betreiber eine bereits vorhandene,
offene Mollie-Erstzahlung des SMA-Händlerkontos hinterlegen. Die Vormerkung
bleibt unverbindlich. Erst „Zahlungspflichtig buchen“ speichert den Auftrag mit
Paket, Bedingungsversion und Zeitpunkt und zeigt den Zahlungslink an.
Wiederholtes Klicken und Neuladen verwenden dieselbe Buchung. Nach dem Buchen
bleibt das Paket bis zur Klärung der Zahlung festgelegt.

1. Im vorhandenen Mitgliedschaftsablauf die Erstzahlung für die zugeordnete
   n8n-Kennung identifizieren. Der Abgleich erwartet `sequenceType=first`,
   `metadata.kunde_id`, `metadata.paket`, die richtige Monatsgebühr in EUR
   und dieselbe Mollie-Kunden-ID. Neue, zugeordnete Konten können den unten
   beschriebenen automatischen Buchungsweg nutzen.
2. Mit einem privaten Mollie-Lesezugang in `SMA_MOLLIE_READ_TOKEN`
   `node n8n/sync-onboarding-payment.mjs tr_ID` ausführen. Das Hilfsprogramm
   ruft die Zahlung bei Mollie ab. Den ausgegebenen SQL-Aufruf zeitnah im
   privaten SQL-Editor ausführen. Er enthält den kundenbezogenen Zahlungslink.
   `OFFERED` bestätigt die Bereitstellung. Ein Paketwechsel vor der Buchung
   schließt das alte Angebot. Ein abgelaufenes Angebot lässt sich ersetzen.
3. Nach der ausdrücklichen Buchung zahlt der Kunde über den angezeigten
   Mollie-Link. Bei der Abrechnung denselben Leseabruf erneut ausführen.
   `PAID` bestätigt die passende Erstzahlung. Die Website-Rückkehr ändert
   keinen Zahlungs- oder Zugangsstatus.
4. Sobald das n8n-Konto für die bezahlte Mitgliedschaft bereitsteht,
   `node n8n/sync-onboarding-payment.mjs tr_ID --mit-konto` ausführen.
   Die Eingaben aus der tatsächlich gespeicherten n8n-Zeile ablesen.
   Beim Zugangstoken genügt die Angabe, ob er vorhanden ist. Das Hilfsprogramm
   liest auch das zugehörige Monatsabo bei Mollie. Erst der bestätigte Abgleich
   schaltet das Paket im Website-Profil frei. `N8N_PENDING` hält den Zugang
   geschlossen. `ACTIVE` bestätigt die Freischaltung.
5. Bei abgelaufener, fehlgeschlagener oder stornierter Zahlung sowie einer
   Rückerstattung oder Rückbuchung die jeweilige Erstzahlung frisch abrufen
   und den SQL-Abgleich ausführen. Eine Rückbuchung schließt den zugehörigen
   Website-Zugang. Die Folgeabrechnung verbleibt im bestehenden n8n-Ablauf.

### Automatische Erstzahlung für zugeordnete Neukonten

Die Vormerkung bleibt unverbindlich. Erst der Klick auf „Zahlungspflichtig buchen“
speichert den Auftrag und fordert einen Zahlungslink für das festgelegte Paket an.
Bei einer Unterbrechung kann der Kunde den Zahlungsstand erneut abrufen.
Nach der Rückkehr von Mollie sieht der angemeldete Kunde den gespeicherten
Status seiner Buchung. Solange die Seite sichtbar ist, prüft sie diesen Stand
bis zu viermal automatisch. Weitere Abfragen sind per Button möglich. Sobald
der Zugang aktiv ist, öffnet die Seite das reguläre Dashboard. Die Rückkehr
und jede Statusabfrage sind rein lesend. „Zur offenen Buchung“ öffnet die
vorhandene Buchung. Sobald Mollie eine laufende oder autorisierte Zahlung
meldet, wird der gespeicherte Checkout-Link ausgeblendet. Nach einem Abbruch,
Ablauf oder Fehlschlag bleibt die alte Buchung geschlossen. Ein neues Angebot
erhält eine eigene Kennung und erfordert wieder „Zahlungspflichtig buchen“.
Ein verspäteter Klick auf das vorherige Angebot erzeugt keinen Auftrag.

Die Edge Function `sma-package-payment` verwendet den privaten n8n-Dienst
`8v2wcz5lh0yUf3sw`. Er nutzt vorhandene Verbindungen zum SMA-Händlerkonto
und zur Datenbank. Die Aufträge an n8n sind einmal gültig. Die Funktion ruft
jede Zahlung bei Mollie ab und prüft Konto, Erstzahlung, Betrag, Währung und Paket.
Nach bestätigter Zahlung legt sie das Monatsabo mit der ersten Folgezahlung einen
Monat nach dem Zahlungstag an. Sie liest das Abo und die Kundenzuordnung aus der
Anbieterantwort bzw. der aktualisierten Kundenzeile. Erst dann öffnet sie den Zugang.
Der bisherige n8n-Zahlungsworkflow empfängt die Folgezahlungen.

Die Einstellung `sma_private.onboarding_payment_settings_v1.enabled` steuert neue
automatische Angebote. Bestehende Buchungen lassen sich weiter abgleichen. Nach
einer unklaren Anbieterantwort außerhalb des Wiederholungsfensters die vorhandene
Zahlung oder das Abo beim Händler abgleichen, bevor weitere Zahlungen angelegt
werden. Rückerstattungen und Rückbuchungen der Erstzahlung sperren den Zugang.
Ein aktives Abo bleibt in diesem Fall beim Händler gesondert zu klären.

Die automatisierten Tests verwenden simulierte Anbieterantworten. Der erste
Durchlauf mit einer echten Kundenbuchung steht aus.

## Ergänzung vom 15.11.2026: TikTok-KI-Kennzeichnung live

PR #304 (`46920c3`) ist nach koordinierter Umstellung von Datenbank,
Provider-/Coverkopie und Client live. Die leere verpflichtende Ja/Nein-Auswahl
wurde im echten Kundenbereich ohne Auftragserstellung geprüft. Die
veröffentlichte 47-Node-Version entspricht dem geprüften Kandidaten.
Sechs Live-SQL-Eingangsfälle in einer zurückgerollten Transaktion sowie die
YouTube-Kontoprüfung und der Rückweg zu den Portalen bestanden. Der vorhandene
Testentwurf und sein Cover blieben erhalten. Kein Medienupload, keine
Kunden-/Operatorfreigabe und kein neuer Übertragungsversuch.

PR #199 wurde ohne Merge durch PR #304 ersetzt. Die TikTok-App-Freigabe für
den öffentlichen Kundenbetrieb und ein gesondert autorisierter Provider-E2E
bleiben eigenständige offene Nachweise. Einzelne bestandene Module bedeuten
weiterhin keine vollständige Startfreigabe. [Live-Abnahme](TIKTOK_AIGC_RELEASE.md).

## Live-Abgleich vom 13.11.2026

Für zwei Aufträge ist eine Kundenfreigabe gespeichert. Beide zugehörigen
Betreiberfenster sind abgelaufen. Version 2 des Startchecks gibt dafür
`operator_permissions=2`, `current_bound_operator_permissions=0` und
`BLOCKED_NO_EXPLICIT_APPROVAL` zurück. Der erste Zähler umfasst alle
gespeicherten Betreiberfreigaben. Der zweite zählt nur solche, deren
Zeitfenster jetzt läuft und deren Fingerprint zum selben geprüften,
vom Kunden freigegebenen Auftrag passt. Selbst bei einem Treffer verlangt
der Bericht die gesonderte Prüfung der Providerstrecke.

Der private YouTube-Test ist abgeschlossen. SMA hat den privaten Videoerfolg
und die separate Coverannahme für dasselbe Video bestätigt
([Cover-Übergabe](PORTAL_COVER_HANDOFF.md), [PR #263](https://github.com/sma-automation/sma-automation.github.io/pull/263)).
Im Produktionsbestand stehen vier SMA-Konten, davon drei nur mit Demozugang
und keines mit aktivem bestätigtem Zahlungseingang. Es gibt vier
Galerie-Musikaufträge und noch keinen registrierten technischen
Galerie-Nachweis. Veröffentlichte Kundenwebseiten und Providerverbindungen
stehen jeweils bei null. Shopify und SMA melden je zehn Bestellungen,
sechs davon als Test. Am 13.11.2026 zeigte der Shopify-Admin unter
**Einstellungen → Zahlungen → Shopify Payments** „Testmodus ist aktiviert“
und „Akzeptiert nur Testzahlungen“. Für diesen Abgleich wurde keine Bestellung
angelegt. Die SQL-Abfrage liest diese externe Einstellung nicht.

**Kundenwebseite.** Die automatisch eingerichtete SMA-Unteradresse gehört weiterhin
zum gespeicherten privaten Testentwurf. Der Einrichtungsauftrag ist aktiv. Am
13.11.2026 zeigte der Browser beim Aufruf über HTTPS „Diese Webseite ist derzeit
nicht verfügbar.“ Der anonyme Inhaltsabruf lieferte ausschließlich
`{"ok":false,"code":"NOT_AVAILABLE"}`. Der Startcheck zählt im Feld
`websites.connections` externe Providerverbindungen. Die SMA-Unteradresse
wurde anhand des Einrichtungsauftrags und der registrierten Adresse geprüft.

Die isolierte Prüfung mit fiktiver Firma führt denselben Webseitenablauf über die
Besitzer-RPC, die anonyme Inhaltsabfrage und den öffentlichen Renderer aus. Eine
veröffentlichte Überschrift und Firmenadresse bleiben sichtbar, während der
Kunde den Entwurf bearbeitet. Eine veraltete Firmenprofilrevision wird bei der
Veröffentlichung abgewiesen. Nach der nächsten gültigen Veröffentlichung erscheinen
die neuen Angaben. Nach der Rücknahme ist der Inhalt beim erneuten Aufruf verborgen.
Entwurf und Adresse bleiben erhalten. Reproduzierbar mit
`node tests/run-website-setup-sql.mjs` nach Installation der Testabhängigkeiten
in `tests/sql-runtime` und `tests/dom-runtime`. Im externen WordPress-Test hat der signierte Auftrag genau einen privaten Produktentwurf erzeugt (Seite 103, Revision 1). Die Vorschau stimmte bei allen drei Artikeln mit dem Testshop überein. Die anonyme REST-Abfrage war gesperrt. Nach Abschluss wurden die Testfreigaben getrennt. Der native
Test verbindet SMA-Ticketausgabe, WordPress-Administratorfreigabe und die
Auftragsverwaltung. Nach einer verlorenen WordPress-Antwort schließt die
Wiederholung denselben Auftrag mit genau einem unveröffentlichten Entwurf ab. [WordPress-Praxistest](WORDPRESS_PRACTICAL_TEST.md) ·
[Früherer Live-Durchlauf der SMA-Unteradresse](CUSTOMER_WEBSITE_AUTOMATION.md).

## Historische Momentaufnahme vom 11.11.2026

| Bereich | Beobachtung | Konsequenz |
| --- | --- | --- |
| SMA-Konten | 4 Kundeneinträge, 3 berechtigt; 0 bestätigt bezahlt, 3 nur Demo | Zahlender Kunden-E2E steht aus |
| Aufträge | 10 gesamt, 9 storniert, 1 vorbereitet, 0 genehmigt | Kein Auftrag für Veröffentlichung freigegeben |
| Provider | 0 Operatorberechtigungen, 0 Versuche, 0 Ereignisse | **Kein echter Provider-E2E nachgewiesen** |
| Medien | 8 verfügbare Dateien, 0 Katalogeinträge in den letzten 15 Minuten frisch bestätigt | Exakte Datei vor einem neuen Auftrag erneut echt prüfen |
| Galerie-Audio | 2 vorhandene Musikjobs; 0 registrierte technische Galerie-Nachweise | Tondatei wurde unabhängig geprüft; Übernahme in sichere Medienprüfung weiter offen |
| Kundenwebseiten | 0 veröffentlichte SMA-Kundenwebseiten, 0 Providerverbindungen | Delta-Webseite/Domain gesondert abnehmen |
| Shop | 10 Bestellungen, davon 6 offiziell als Test gekennzeichnet | Shopify und SMA stimmen bei der Anzahl überein; aktueller Payments-Testmodus unbekannt |

**Galerie-Registrierung (zusätzliche Live-Prüfung am 11.11.2026):**
Die private Registrierungsfunktion ist über die bereits erfasste Migration
`20261111151051_gallery_technical_evidence_service_only_v1` in Supabase
installiert und ausschließlich für `service_role` ausführbar. Die private
Snapshot-Leserolle und die vorbereitete Worker-Identität sind `NOLOGIN`
ohne Passwort; der Server-Worker
ist noch nicht aktiviert. **0** technische Galerie-Einträge bedeuten:
kein abgenommenes Registrierungs-E2E. Die SQL-Vorlage **nicht erneut**
installieren; die nächste Abnahme betrifft den unabhängigen privaten Worker.

Zu den bereits bestätigten Modulen gehören die Dashboard-Suche,
die mobile Navigation, die Shopify-Bestellklassifizierung,
der geschützte Warenkorb-Vorbereitungsweg, Galerievertonung
und einzelne YouTube-/TikTok-Vorbereitungsschritte. Daraus folgt
**keine** vollständige End-to-End-Veröffentlichungsfähigkeit.

## Reihenfolge bis zu ersten Kunden

1. **Freigabekette:** Konto- und Mediennachweis für eine konkrete
   Kunden-Dateirevision frisch abrufen. Persönliche Inhalts-,
   Rechte-, Musik-, Werbung- und ggf. KI-Kennzeichnung bestätigen
   lassen. Alte Aufträge/Fristen nicht automatisch verlängern.
2. **Ein einzelner privater Provider-Test:** Erst nach ausdrücklicher
   Betreiberfreigabe, kundenseitiger Zustimmung, gültigem Auftrags-
   Fingerprint und separater Operatorberechtigung. YouTube privat
   und TikTok nur für die freigegebene Sichtbarkeit, niemals
   stillschweigend öffentlich. Provider- und Cover-Ergebnisse
   einschließlich eindeutiger externer IDs nachweisen.
3. **Galerie- und Video-Nachweise:** Vertrauenswürdige Übernahme
   der bereits unabhängig geprüften gespeicherten Musik-MP4
   vorbereiten, ohne Operator-Receipt zu fälschen. Für die derzeit
   gesperrte visuelle Videoanalyse (`VIDEO_PLAN_REQUIRED`)
   keine kostenpflichtige Tarifänderung ohne Zustimmung.
4. **Webseite und Verkauf:** Eine vollständige fiktive
   Kundenwebseite einschließlich WordPress-/Domain-Anbindung
   zunächst isoliert abnehmen. Der Shopify-Payments-Testmodus wurde am
   13.11.2026 direkt im Admin bestätigt (siehe Live-Abgleich oben).
5. **Produktfreigabe:** Testnutzer kann ohne Anleitung Datei,
   Text, Portal, Freigabe, Shop und History finden. Fehler und
   ausstehende Nachweise werden sichtbar als solche markiert,
   niemals als erfolgreich.

## Wiederholen

Den SQL-Inhalt in der **berechtigten Supabase SQL-Ansicht** oder
über eine autorisierte interne, rein lesende Verbindung ausführen:

Für vorbereitete YouTube-Aufträge und bereits geprüfte private Aufträge gibt es außerdem
den separaten [Nur-Lesen-Abnahmecheck](YOUTUBE_PRIVATE_RELEASE_PREFLIGHT_20261111.md)
mit dem Prüf-SQL `supabase/sql/youtube-private-release-preflight-readonly.sql`.
Er zeigt die Teilprüfungen der Vorbereitung. Bei geprüften privaten Aufträgen
zählt er aktuelle und abgelaufene gebundene Berechtigungen, erfasste
Übertragungsversuche und bestätigte private Ergebnisse.

```text
supabase/sql/launch-readiness-readonly.sql
```

Der Ausdruck `files_verified_last_15m` ist ein **globaler
Momentzähler**, kein Dateibeweis für einen konkreten Auftrag.
Er ist besonders nach längeren Arbeitspausen normalerweise null.
Ein aktueller Nachweis muss immer zur **exakten Datei- und
Auftragsrevision** passen.

Die Felder `external_e2e_status=NOT_VERIFIED_BY_THIS_QUERY`,
`allows_publication=false` und
`initiates_checkout=false` werden absichtlich nie durch
einfache Zählerüberschreitungen auf »bereit« gesetzt.
TikTok-KI-Pflichtwahl ist seit PR #304 live abgenommen (siehe Ergänzung vom
15.11.2026); PR #199 wurde dadurch ohne Merge ersetzt. Die visuelle weitere Vereinfachung der Vorschau
(Issue #198) ist ausdrücklich **erst nach der Kernabnahme**
vorgesehen.

## Technische Absicherung

`tests/launch-readiness-readonly.test.cjs` kontrolliert,
dass die Datei ausschließlich eine lesende SQL-Abfrage enthält,
keine persönlichen Daten ausgibt und Veröffentlichungs- sowie
Checkout-Sperren nicht aufhebt. `node tests/run-launch-readiness-sql.mjs`
prüft den tatsächlichen Bericht mit acht Szenarien in einer isolierten
PostgreSQL-Datenbank, darunter abgelaufene, noch nicht begonnene und
nicht mehr zum Auftrag passende Freigaben. Version 2 wurde am 13.11.2026
auf dem vorhandenen SMA-Supabase-Projekt rein lesend ausgeführt.

Keine neuen Tabellen, Rollen, Berechtigungen, Workflows,
Provider-Aufrufe, Echtkäufe oder Kosten.
