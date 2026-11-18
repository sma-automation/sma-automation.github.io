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

## Kundenstart-Zuordnung im rein lesenden Startcheck (17.11.2026)

Version 5 des bestehenden SMA-Startchecks ergänzt eine gesonderte
Prüfung für berechtigte Konten ohne n8n-Verweis. Bereits seit Version 4
zählt `accounts` die Website-Kunden mit gespeicherter n8n-Referenz,
neue Onboarding-Profile sowie deren offene und abgeschlossene
n8n-Zeilenzuordnungen. Der Schalter für automatische Erstbuchungen ist
`true` oder `false` bei genau einem Einstellungsdatensatz, andernfalls
`null` (keine eindeutige Konfiguration). Die Ausgabe gibt keine
Kundennamen, Kennungen, Adressen, Medieninhalte oder Tokens preis.

Die Werte `drive_folder_access` und `first_paid_customer_e2e` bleiben
stets `NOT_VERIFIED_BY_THIS_QUERY`. Weder die gespeicherte n8n-Referenz
noch ein eingeschalteter Zahlungsschalter ersetzen den echten
[Drive-Ordnercheck](ONBOARDING_FOLDER_PREFLIGHT.md), den Zahlungsbeleg
oder den ersten praktischen Kunden-E2E. Es wird nichts aktiviert,
erstellt, veröffentlicht oder als n8n-Execution ausgelöst.

**Nur-Lesen-Livestand vom 17.11.2026, ca. 15:18 Uhr Wien:**
4 Website-Konten (3 Demo, 0 zahlend), 2 mit n8n-Referenz,
0 neue Onboarding-Profile, 0 offene manuelle n8n-Zuordnungen,
automatischer Erstbuchungsschalter an. Noch kein zahlender Kunden-E2E.

**Zusätzlicher Live-Abgleich vom 17.11.2026 (nur SELECT, keine Änderung):**
Von 3 berechtigten Konten haben 2 eine nichtleere n8n-Referenz und 1 keine.
Der Bericht zeigt dazu `entitled_with_n8n_reference` und
`entitled_without_n8n_reference`. Ohne eine Referenz erhält der aggregierte
Status `ENTITLED_N8N_REFERENCE_REVIEW_REQUIRED`, sofern nicht bereits eine
neue manuelle n8n-Zeilenzuordnung wartet. Das ist eine **Prüfaufforderung**:
Ein älterer Testkunde kann einen abweichenden Legacy-Zuordnungsweg haben.
Keine Zeile automatisch ergänzen, keine Ordner-IDs kopieren und keine Zahlung
oder Veröffentlichung durch bloße Referenzvergabe freigeben. Die bestätigten
Drive-Ordnerfelder und deren tatsächliche Berechtigungen sind getrennte Fragen.
Die erweiterte SQL-Version 5 wird im Repository geprüft; die zusätzliche
Live-Zählung selbst war eine eigenständige SELECT-Abfrage, **kein** schon
nachgewiesener Voll-Live-Durchlauf von Version 5.

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
3. Die gespeicherte n8n-Zeile erneut öffnen. Die interne numerische `id`,
   die Kennung, die E-Mail-Adresse, das leere Paket und die drei Schalter
   `zugang_aktiv`, `zahlung_bestaetigt`, `demo_delta_aktiv` ablesen.
   Zusätzlich mit **EIN/AUS** bestätigen, ob `zugangs_token`, `zugangs_link`,
   `mollie_customer_id` oder `mollie_subscription_id` **vorhanden** sind.
   Für eine unbenutzte neue Zeile müssen alle vier Angaben **AUS** sein.
   Dabei niemals Token, Links oder Händlerreferenzen in den Chat oder in
   Eingabefelder des Hilfsprogramms kopieren. Im Projektverzeichnis den
   folgenden lokalen Befehl starten und die abgefragten Werte eingeben.
   Das Hilfsprogramm lehnt wiederverwendete Zeilen ab und gibt nur dann
   den fertigen privaten SQL-Aufruf aus. E-Mail-Adressen mit Sonderzeichen
   werden korrekt codiert. Der Datenbankabgleich erwartet weiterhin exakt
   die sieben vorhandenen Beweisfelder, keine Tokens oder zusätzlichen Spalten.

   ```sh
   node n8n/confirm-onboarding-row.cjs
   ```

   Den ausgegebenen Aufruf im privaten Supabase-SQL-Editor ausführen. Er enthält
   die abgelesenen Angaben. Die Datenbank gleicht diese mit der Vormerkung ab.

4. `LINKED` bestätigt die erste Zuordnung, `ALREADY_LINKED` die Wiederholung
   mit derselben Zeile. Bei allen anderen Ergebnissen Kennung, Adresse,
   Eindeutigkeit und Status erneut prüfen. Beide Konten bleiben inaktiv.
   Bei einem späteren Adresswechsel müssen Website und n8n erneut abgeglichen werden.

### Kundenordner vor der ersten Buchung prüfen (16.11.2026)

Die Kontozuordnung allein richtet keine Drive-Ordner ein. Vor der ersten
automatischen Zahlung müssen in derselben geprüften `SMA_Kunden`-Zeile
`upload_folder_id` und `processing_folder_id` auf die beiden vorhandenen,
kundeneigenen Ordner zeigen. Fehlt die Einrichtung, zunächst den bestehenden
Kundenordner-Ablauf abschließen und dessen gespeicherte Zuordnung prüfen.
Die IDs müssen verschieden sein; zulässig sind jeweils 10–200 Zeichen aus
Buchstaben, Ziffern, Unterstrich und Bindestrich.

Mit der für den Dateikatalog eingerichteten Google-Drive-Verbindung beide IDs
prüfen: Ordner vorhanden, nicht gelöscht und `canListChildren=true`.
Der Verarbeitungsordner muss außerdem `canAddChildren=true` erlauben.
`upload_folder_id` bezeichnet **01 Upload – Eingang**;
`processing_folder_id` bezeichnet **02 Verarbeitung**. Manuelle Dashboard-Dateien
gehen in den Verarbeitungsordner. Der Eingang gehört zum bisherigen automatischen
Veröffentlichungsablauf. Eine leere, erreichbare Galerie ist ein gültiger Start;
ein fehlender oder nicht erreichbarer Ordner ist keine leere Galerie.

Der Zahlungsabgleich prüft die gespeicherten IDs vor neuer
Mollie-Kunden-/Erstzahlungsanlage und vor der Erstaktivierung. Sie liest die
Zuordnung nach den Anbieterprüfungen erneut. Der Aktivierungsauftrag bindet
die Tabellenänderung an genau dieses Paar; das Rücklesen muss dasselbe Paar
bestätigen, bevor der Website-Zugang aktiv wird. Diese Prüfung bewertet die
Zuordnung, sie ersetzt keine Drive-Berechtigungsprüfung. Bestehende
Rückerstattungen, Rückbuchungen, Zugangssperren und Folgezahlungs-Wiederherstellungen
bleiben von den Ordnerfeldern unabhängig.

**Koordinierte Bereitstellung:** Die private `account`-Antwort des Zahlungsdiensts
muss beide Ordnerfelder liefern. Der n8n-Worker und die Edge Function
`sma-package-payment` werden deshalb koordiniert umgestellt. Zuerst den
vorbereiteten n8n-Worker veröffentlichen und dessen private Antwort bestätigen;
direkt danach den zugehörigen Edge-Stand bereitstellen. Zwischen diesen beiden
Schritten kann der neue Worker Erstaktivierungen des alten Handlers ohne
gebundene Ordner-IDs ablehnen. Diesen Übergang vor neuen Kundenbuchungen
abschließen. Der neue Stand darf erst nach Prüfung beider Komponenten als
bereitgestellt gelten. Es wird keine automatische Drive-Provisionierung ergänzt.

Isolierte Abnahme: `tests/automatic-package-payment.test.cjs` verbindet
Zahlungsaktivierung, tatsächliche n8n-Antwortprojektion und Katalog-Ordnerprüfung.
`tests/run-onboarding-plan-sql.mjs` prüft zusätzlich den bestehenden SQL-Ticketweg
mit den neuen Aktivierungsfeldern sowie die Folgeabrechnung eines Bestandskontos
ohne Ordnerfelder. Diese Prüfungen verwenden ausschließlich synthetische Daten.

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
   Website-Zugang. Für betreute Pilotbuchungen verbleibt die Folgeabrechnung im bisherigen n8n-Ablauf.

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
Monat nach dem Zahlungstag an. Sie speichert die geprüfte Mollie-Abo-ID und
ruft dieses Abo beim Händler erneut ab. Konto, Buchung, Paket, Betrag,
Monatsintervall und Startdatum müssen passen. Der bereits bezahlte erste
Monat wird freigeschaltet, wenn das Abo aktiv ist oder Mollie für ein noch
ausstehendes Abo den vereinbarten Starttag als nächsten Zahlungstermin meldet.
Zuletzt liest SMA die aktualisierte n8n-Kundenzeile, bevor es den Zugang öffnet.
Bei unklarem Termin kann der Dienst dieselbe Abo-ID später erneut lesen.
Ist der bezahlte erste Monat inzwischen abgelaufen und der Zugang noch gesperrt,
prüft SMA eine bezahlte Folgeperiode vor der ersten Freischaltung.

Die Einstellung `sma_private.onboarding_payment_settings_v1.enabled` steuert neue
automatische Angebote. Bestehende Buchungen lassen sich weiter abgleichen. Nach
einer unklaren Anbieterantwort außerhalb des Wiederholungsfensters die vorhandene
Zahlung oder das Abo beim Händler abgleichen, bevor weitere Zahlungen angelegt
werden. Rückerstattungen und Rückbuchungen der Erstzahlung sperren den Zugang.
Ein aktives Abo bleibt in diesem Fall beim Händler gesondert zu klären.

Die automatisierten Tests verwenden simulierte Anbieterantworten. Der erste
Durchlauf mit einer echten Kundenbuchung steht aus.

### Folgezahlung einer automatischen Paketbuchung prüfen

Für eine gemeldete Abbuchung aus einem SMA-Monatsabo kann der Betreiber die
Zahlungs-ID mit dem vorhandenen Mollie-Lesezugang prüfen:

```sh
node n8n/sync-onboarding-payment.mjs tr_ID --folgezahlung
```

Das Programm liest die Einzelzahlung und anschließend ihr Abo über das
zugehörige Mollie-Konto. Den ausgegebenen `SELECT` im privaten SQL-Editor
ausführen. `ZUGEORDNET` bestätigt, dass Abo, Paket, Konto und Buchung zu diesem
Beleg passen. Das Ergebnis zeigt den Zahlungsstatus, Erstell- und Zahlungszeit in
UTC, erstattete und rückgebuchte Eurobeträge sowie den aktuellen Buchungs- und
Website-Zugang. Auch eine teilweise Erstattung ist am Betrag erkennbar.
`NICHT_ZUGEORDNET` lässt alle Ergebnisfelder frei. `PRUEFEN` beim Website-Zugang
kennzeichnet widersprüchliche Profildaten.

Der Abgleich liest einen einzelnen Beleg. Bei einer fehlgeschlagenen Abbuchung
auch spätere Zahlungsversuche für denselben Monat prüfen. Der Betreiberabgleich
verändert weder Zugang noch Abo.

Neue automatische Buchungen erhalten einen eigenen signierten Rückruf für
Folgezahlungen. SMA liest die Erstzahlung, das zugeordnete Monatsabo und alle
Seiten seiner Abbuchungen beim Händler. Vor einer Änderung muss die gemeldete
Zahlungs-ID in diesem Abo vorhanden sein. Der bestehende private Zahlungsdienst
verwendet hierfür den zusätzlichen Einstieg `sma-paket-folge-dienst-v1`.

Abrechnungsperioden beginnen am Starttag des Abos, in kurzen Monaten am
Monatsende (UTC). Ein erfolgreicher späterer Abbuchungsversuch deckt mindestens
bis zum entsprechenden Tag des Folgemonats ab. Eine bestätigte volle Zahlung
deckt die laufende Periode auch bei einer älteren Fehlermeldung. Ein laufender
Versuch lässt den bisherigen Zugang bestehen. Ohne deckende Zahlung führen ein
endgültiger Fehlschlag, eine vollständige Erstattung oder eine Rückbuchung der
aktuellen Abbuchung zur Pause. Eine Teilerstattung bleibt zur Betreiberprüfung.
Zuerst sperrt SMA die Website, dann die zugehörige n8n-Zeile. Bei einer
bestätigten Ersatzzahlung öffnet SMA ausschließlich eine durch diesen Abgleich
gesetzte Sperre. Erst nach Rücklesen der n8n-Zeile öffnet sich die Website.

Mollie-Rückrufe lösen den Abgleich sofort aus. Zusätzlich sucht der private
Datenbankjob `sma-package-renewal-due-v1` alle fünf Minuten nach fälligen
automatischen Buchungen mit bereits zugeordneter Erstzahlung und Abo-ID. Pro
Lauf verarbeitet er bis zu zehn Buchungen. Bei leerer Warteschlange gibt es
keinen Aufruf der Zahlungsfunktion, von n8n oder von Mollie. Jeder fällige
Auftrag erhält ein zwei Minuten gültiges Einmalticket für die Zahlungsfunktion
desselben Supabase-Projekts. Der Zeitplan kann ausschließlich bestehende
Zahlungen und Abos abgleichen.

Bei bestätigter Deckung ist der nächste planmäßige Abruf am ersten nicht mehr
gedeckten Tag (UTC) fällig. Eine Kündigung oder ein abgeschlossenes Abo lässt
bezahlte Zeit bestehen. Nach ihrem Ablauf pausiert der Zugang, wenn weder
eine deckende Zahlung noch ein offener Versuch oder eine Teilrückerstattung
vorliegt. Für ein wegen ungültigen Mandats ausgesetztes Abo gelten dieselben
Deckungsregeln mit täglicher Nachprüfung. Ein aktives Abo ohne eindeutigen Zahlungsbeleg und Fälle zur
Betreiberprüfung werden nach einem Tag erneut geprüft. Bereits pausierte,
beendete Abos werden nach einem Monat noch einmal geprüft. Providerfehler
lösen Wiederholungen nach 15 Minuten, einer Stunde und danach alle sechs
Stunden aus. Eine bestätigte Rückbuchung der Erstzahlung beendet den
Zeitplan nach Prüfung der Sperre. Demo- und betreute Pilotkonten verwenden
ihre bisherigen Zugangswege.

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


## Revisionsgebundener Galerie-Nachweis – Startcheck vom 17.11.2026

Der rein lesende Betreibercheck `supabase/sql/launch-readiness-readonly.sql`
zeigt neben den bisherigen Galerie-Zählern jetzt drei zusätzliche Werte an:

- `gallery_current_revision_evidence_jobs`: Zahl abgeschlossener Musikaufträge,
  für die ein technischer Galerie-Nachweis **zu den aktuell verfügbaren Original-
  und Ergebnisdateien** passt. Verglichen werden Datei-IDs, Kunden-/Benutzerzuordnung,
  beide SHA-256-Revisionswerte, gespeicherter Ergebnis-Hash und Dateigröße.
- `gallery_completed_without_current_evidence`: abgeschlossene Musikaufträge,
  denen dieser revisionsgebundene Nachweis fehlt, einschließlich historischer
  Nachweise für inzwischen geänderte Dateien.
- `gallery_evidence_state`: `NO_COMPLETED_GALLERY_JOB`,
  `CURRENT_GALLERY_EVIDENCE_REQUIRED` oder
  `REVISION_BOUND_EVIDENCE_PRESENT_NOT_PUBLISH_PERMISSION`.

Die ältere Zahl `gallery_completed_without_record` bleibt für den
Vergleich erhalten. Ein vorhandener Datensatz allein ist **kein** gültiger
revisionsgebundener Nachweis. Der Startcheck akzeptiert auch bei passender
Revision **weder Medienupload noch Veröffentlichung**; unabhängige
Byte-/Dekodierprüfung, Inhalts-/Rechteprüfung, aktuelle Konten- und
Dateiverifikation und persönliche Betreiberfreigabe sind getrennt erforderlich.

Die isolierte SQL-Regression simuliert ausdrücklich eine geänderte
Originalrevision, eine geänderte Ergebnisrevision, einen fremden
Kundenbezug und eine nicht mehr verfügbare Ergebnisdatei. Jede Abweichung
senkt `gallery_current_revision_evidence_jobs`, ohne ein historisches
Beweisdokument zu ändern. Der Test selbst schreibt ausschließlich in
eine lokale PGlite-Testdatenbank. In der produktiven Supabase-Datenbank
wurde nur die SELECT-Abfrage des Berichts ausgeführt – keine Migration,
keine Medienfreigabe und kein n8n-Lauf.


## Neukunden ohne n8n-Zuordnung verständlich begleiten (18.11.2026)

PR #372 ergänzt nach einer gespeicherten Paketvormerkung ohne bestätigte
n8n-Kontozuordnung den ausdrücklichen Status
„Dein SMA-Kundenkonto wird eingerichtet. Du musst noch nichts bezahlen.“
Über **„Kontozuordnung prüfen“** kann der angemeldete Kunde den aktuellen Stand
selbst erneut abrufen. Sobald die vorhandene Backend-Zuordnung bestätigt wird,
verschwindet der Prüfbutton, und die reguläre Buchungsansicht erscheint
ohne erneute Vormerkung oder Seitenneuladung. Vorher gibt es keinen Checkout.

Die Prüfung verwendet ausschließlich den bereits vorhandenen, eigentümergebundenen
Leseweg in `sma_onboarding_plan_choice_v1`; für ein zugeordnetes Konto wird
der bestehende `sma_onboarding_booking_v1`-Stand gelesen. Es gibt weder
automatischen Zeitplan noch n8n-Aufruf, Provider-Check, Zahlung, Aktivierung,
neue Berechtigung oder Änderung am Kundenpaket. Nur eine ausdrücklich vom
Kunden gewünschte neue Paketauswahl darf weiterhin speichern. Desktop- und
Mobilbrowser-Regressionen prüfen die neue Statusanzeige, reine Abfragen,
die verzögerte Zuordnung und den Übergang ohne Doppelbuchung.

Die eigentliche einmalige n8n-Kundenzeilenzuordnung und der Google-Drive-
Ordnerzugriff müssen weiterhin vor einer echten Erstbuchung bestätigt werden.


## Shopify-Bestellspiegel: frischer Live-Nachweis vom 18.11.2026

Der bereits aktive Shopify→Supabase-Bestellspiegel wurde erneut
direkt gegen Shopify Admin GraphQL gelesen:
**10 von 10 Bestellungen stimmen in Kennung, Teststatus,
Quellrevision, Zahlungsstatus, Lieferstatus, Betrag und Währung
vollständig überein; keine Abweichung.** Es wurden weder
Käufe noch Bestelländerungen ausgeführt. Ein `PAID`-Status
von Shopify bei Nicht-Testbestellungen ist kein unabhängiger
Bankzahlungsbeleg. Einzelheiten und Grenzen:
[`SHOP_ORDER_TEST_MODE.md`](SHOP_ORDER_TEST_MODE.md).

Dieser Nachweis betrifft nur den **historischen Shopify-Bestellspiegel**.
Er ersetzt weder eine neue reale Kundenanmeldung,
die n8n-Kundentabellen-/Drive-Ordnerfreigabe,
den vollständigen Zahlungs-/Dashboard-Erstkundentest
noch die erforderlichen Veröffentlichungs- und Providerfreigaben.


## Version 6 – Kundenmusik fehlt trotz fälliger Galerieaufträge (18.11.2026)

Die rein lesende Bestandsabfrage unterscheidet ab Version 6 zusätzlich
**fehlende freigegebene Musiktitel** von tatsächlich fehlgeschlagenen
Galerieaufträgen. Die neue Rubrik `media` zählt
`gallery_pending_without_track` und `gallery_pending_with_failures`
getrennt und meldet einen festen `music_customer_state`.

Der echte Live-Abgleich vom 18.11.2026 ergab: **drei fällige ausstehende
Galerieaufträge, keiner mit zugeordnetem Track oder bisherigem Fehler,
und null für Kunden gelistete Tracks**. Ein vierter Auftrag ist historisch
abgeschlossen, besitzt aber keinen aktuellen revisionsgebundenen
technischen Evidenzdatensatz. Die bisher erfolgreichen Cron-Ausführungen
sind kein Beleg für abspielbare, lizenzierte Musikfassung.

Dementsprechend meldet der Startcheck bei fälligen Aufträgen und
null gelisteten Tracks `NO_LISTED_TRACK_FOR_PENDING_JOBS`. Er kann
**nicht** feststellen, ob genau deshalb die Aufträge warten: Dazu
wären die aktuelle n8n-Arbeitsstrecke und ein tatsächlich freigegebener
Musiktitel im geschützten Testkonto praktisch zu prüfen.

Der Check zählt außerdem `music_ready_tracks` aus der tatsächlich im
SMA-Renderer verwendeten View `music_catalog_ready_v1`: Dort erscheinen
nur gelistete Titel mit passendem gespeichertem Objekt und Metadaten.
Ein bloß gelisteter, aber fehlender Audio-Master erzeugt daher
`LISTED_TRACKS_NOT_READY_FOR_PENDING_JOBS`.

Zusätzlich zählt `music_aac_ready_tracks` nur Master mit mindestens
einem **passenden AAC-Renderobjekt** in `storage.objects` nach demselben
Namens-, MIME- und Größenvertrag wie der private Galerie-Dispatcher.
Ein Master ohne dazugehörige AAC-Datei erzeugt
`READY_MASTER_WITHOUT_AAC_FOR_PENDING_JOBS`; selbst mit gültigem
AAC-Objekt meldet der Check nur `GALLERY_DUE_WORK_NEEDS_REVIEW` bzw.
`AAC_BACKED_TRACK_NOT_LICENSE_OR_MEDIA_E2E_VERIFIED` – **niemals**
eine automatische Provider-/Musikfreigabe.

Im zusätzlichen echten Leseabgleich war der einzige private Katalogmaster
mit seinem Speicherobjekt vorhanden, aber **kein passendes AAC-Renderobjekt
diesem Master zuordenbar**. Ein weiteres vorhandenes AAC-Objekt war kein
Nachweis für genau diesen Master. Eine blinde Freigabe des
privaten Techniktons wäre daher sowohl rechtlich als auch technisch
ungeeignet. Der erste eigens freigegebene Master mit passendem AAC und
tatsächlichem Kunden-Musikrecht bleibt Voraussetzung für den Praxistest. Das Feld
`music_customer_e2e` bleibt grundsätzlich
`NOT_VERIFIED_BY_THIS_QUERY`. Keine Kundendaten, Dateipfade,
Tokens oder Medienbytes werden ausgelesen. Dieser Nachweis erstellt
keine Songs, löst keine Verarbeitung und keine Gutschriften aus.
