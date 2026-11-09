# Eigene Musikbibliothek V1

Stand: 06.11.2026. Eigene MP3-/WAV-Dateien werden im privaten Kundenbereich
dauerhaft gespeichert. Im Dashboard bleiben die Kapitel **Tracks** und
**Meine Playlist** mit der freigegebenen feinen Unterstreichung erhalten.

## SMA-Musikkatalog und Credits – Stand 07.11.2026

Die vorhandene Bibliothek speichert private Uploads je Kundenkonto. Unter
**Meine Playlist** werden die eigenen Favoriten angezeigt. Im geprüften
Datenbestand ist ein fertiger Track vorhanden, der dokumentierte Technik-Testton.

Für die kommenden, von SMA produzierten Musikstücke ist das Paketmodell festgelegt.

| Zugang zum SMA-Musikkatalog | Vereinbarte Nutzung |
| --- | --- |
| Delta | Im Paket enthalten. |
| Alpha und Beta | Kauf ausschließlich im Zehnerpaket für 10 Euro. Ein Credit entspricht der Freischaltung eines Tracks. |

Die Freischaltung bezieht sich auf einen Musiktitel. Der automatische Zuschnitt
für ein weiteres Video löst keinen weiteren Trackkauf aus. Ein neuer Galerieclip
ohne Audiospur soll bei Bedarf Musik aus den für das Kundenkonto freigeschalteten
SMA-Titeln erhalten. Bereits vertonte Videos behalten ihren Ton. Diese Paketregel
betrifft den SMA-Katalog. Die bestehenden persönlichen Uploads sind separat.

**Prüfstand vor der Anbindung (PR #134).** Das Kundendashboard hatte eine
Guthabenanzeige und einen deaktivierten Aufladeknopf. Die Mollie-Zahlungsstrecke
für Mitgliedschaften war vorhanden. Es gab noch keine Buchungen für Musikkäufe.

Der Zuschnitt ist lokal separat geprüft. Beim stummen Türgriff-Original blieb
der Videostream bytegleich. Ein zwölf Sekunden langer synthetischer Ton wurde
auf 10,041 Sekunden zugeschnitten (Video 10,041667 Sekunden). Der bereits
vertonte Drei-Sekunden-Export wurde übersprungen. Diese lokale Prüfung nutzte
weder einen Kundenkauf noch einen Titel aus dem künftigen SMA-Katalog.

### Kauf und Nutzung eines SMA-Tracks

Unter **Musikbibliothek → SMA-Musik** erscheinen die veröffentlichten
Katalogtitel, fünf pro Seite. Auch **Einstellungen → Paket & Credits** zeigt das
Musikguthaben. Delta inklusive Demo kann die bereitgestellten Tracks direkt
verwenden. Alpha und Beta können mit einem Credit einen bestimmten Titel
freischalten. Ein freigeschalteter Titel erscheint zusätzlich in der
Musikauswahl im Medieneditor und kann erneut verwendet werden.

Jede produktiv bestätigte Einmalzahlung über genau 10,00 EUR gewährt ein Paket
mit zehn Musik-Credits. Der Zahlungsauftrag ist an Benutzer und Kundenkonto
gebunden. Die Edge Function liest Zahlungsstatus, Modus, Betrag, Währung,
Artikelkennung und Auftrag direkt bei Mollie. Eine Rückkehr ins Dashboard
bestätigt keine Zahlung. Kunden-RPCs können kein Guthaben buchen. Der Zugriff
auf die privaten Audiodateien wird auch beim Abruf geprüft.

Eine pro Kundenkonto serialisierte Datenbankbuchung verhindert doppelten
Verbrauch beim erneuten Freischalten und bei parallelen Anfragen. Der
Zahlungsbeleg ist eindeutig. Rückerstattungen oder Rückbuchungen sperren die
betroffenen Paketansprüche. Eine verspätete ältere Erfolgsmeldung kann sie
nicht erneut aktivieren. Eine teilweise Erstattung setzt das betroffene Paket
bis zur manuellen Klärung ebenfalls aus.

**Bereitstellung der Musik.** SMA legt seine eigenen freigegebenen Master im
privaten Bucket `sma-katalog` ab. Objektname ist die SHA-256 der Originalbytes
plus `.wav` oder `.mp3`. Die Administration trägt dieselbe Prüfsumme, MIME,
Bytezahl und Titel in `sma_private.music_catalog_v1` ein und setzt `listed`.
Der Katalog listet nur passende gespeicherte Objekte. Der Browser kontrolliert
die Prüfsumme und Größe beim Abruf. Private Kundenuploads bleiben im separaten
Bucket `sma-musik`.

**Zahlungsanschluss.** `sma-music-credit-pack` benötigt das serverseitige
Secret `SMA_MUSIC_MOLLIE_KEY` des SMA-Händlerkontos. Das Dashboard bietet den
Kauf erst bei verfügbarem Katalog und eingerichteter Live-Anbindung an. Für die
technische Abnahme werden keine Händlerzugangsdaten aus der n8n-Sicherung
kopiert. Testbelege erzeugen kein echtes Guthaben. Die automatisierte Prüfung
verwendet einen isolierten Zahlungsanbieter und synthetische Konten.

Am 07.11.2026 wurde die Migration
`20261107145457_music_catalog_credits_v1.sql` eingespielt. Der Zahlungsanschluss
ist bereitgestellt. Sein Statusabruf meldet `enabled: false`. Es gibt derzeit
keinen gelisteten SMA-Master, keinen Musikkauf und keine Trackfreischaltung.
Der Technikton bleibt ein privater Kunden-Track. 79 isolierte SQL- und
Ablaufprüfungen einschließlich Zahlungsrückmeldung und 601 Repository-Tests
sind bestanden.

### Automatische Musik für neue Galerieclips

Beim ersten Eingang einer unterstützten MP4 im Dateikatalog merkt SMA das Video
für das zugehörige Kundenkonto vor. Der separate n8n-Workflow verarbeitet
geeignete Clips selbstständig, sobald ein freigegebener Katalogtitel mit
vorbereiteter AAC-Datei verfügbar ist. Die Browser-Verarbeitung übernimmt
weitere unterstützte MP4-Dateien beim Öffnen des Dashboards oder der
Portaloptimierung. Ältere Galeriedateien werden beim nächsten
Ordnerabgleich nicht nachträglich eingeplant.

SMA wählt einen für das Konto verfügbaren Track aus dem zentralen SMA-Katalog.
Bei Alpha und Beta muss der Titel bereits freigeschaltet sein. Der automatische
Ablauf kauft weder Credits noch Tracks. Fehlt ein Titel, wartet das Video.
Die persönliche Kundenbibliothek und der Technik-Testton sind keine Quelle.

Die Tonprüfung liest die tatsächlichen Medienstreams. Jede bestehende Audiospur
bleibt erhalten, auch eine leise oder stumme Spur. Für eine MP4 mit einer
einzelnen Videospur ohne Audio kopiert SMA die Bildspur, wiederholt oder kürzt
die Musik auf Videolänge und erzeugt eine AAC-Spur bei 25 % Lautstärke.
Der erste Ausbau unterstützt bis zu 60 Sekunden und 24 MB pro Ein- und
Ausgabedatei. Die Fassung erscheint als **Video mit SMA-Musik** in der Galerie,
das Original bleibt separat verfügbar.

Wiederholungen verwenden dieselbe Upload-ID und ab der Reservierung dieselbe
erwartete Prüfsumme. Mehrere Tabs teilen einen Bearbeitungsplatz je Konto. Eine
verifizierte fertige Datei wird bei der Wiederaufnahme erkannt. Ein abgelaufener
Upload mit unklarem Ergebnis endet mit einem Hinweis zur Prüfung des Kundenordners.
Die Ausgabe startet keine weitere automatische Vertonung.

Geprüft mit der FFmpeg-Browserlaufzeit, synthetischen kürzeren und längeren
Tracks sowie einer lokalen Kopie des Türgriff-Originals (241 Bilder, 10,041667 s;
AAC 10,040998 s). Beim vorhandenen Drei-Sekunden-Export blieb die Tonspur erhalten.
Der erste vollständige Kundendurchlauf mit einem produzierten SMA-Master steht aus.

**Unterbrechung nach dem Upload.** Sobald der bestätigte Geräte-Upload oder ein
späterer Kundenordner-Abgleich die fertige Musikfassung im Katalog speichert,
ordnet die Datenbank sie dem reservierten Auftrag zu. Der Abgleich wartet das
Transaktionsende ab, weil Drive Original und Ausgabe in beliebiger Reihenfolge
liefern kann. Kundenkonto, Quellversion, reservierte Drive-ID, Dateiname, Größe
und SHA-256 müssen passen. Auch ein später eindeutig geklärter Upload kann den
Status „Kundenordner prüfen“ verlassen. Ein offener Tab ist für diesen Abschluss
entbehrlich.

Der isolierte Durchlauf in `tests/run-gallery-music-receipt.mjs` verbindet den
echten FFmpeg-Zuschnitt, den Katalogzugriff eines Alpha-Kontos, die
Uploadreservierung, den Dateitransfer und die SQL-Bestätigung. Drive und die
Storage-Datei werden im Test lokal bereitgestellt. Das Fenster schließt nach
dem letzten übertragenen Byte. Ein nachfolgender Abgleich findet genau eine
Musikfassung. Wiederholte Bestätigungen liefern dieselbe Datei. Ein falscher
Hash, eine abweichende Größe, ein fremder Dateiname oder eine geänderte Quelle
verhindern die Zuordnung. Das Testkonto behält seine neun übrigen Credits.

### Produktlinks für vertonte Videos

In der Portaloptimierung erscheint eine bestätigte Musikfassung mit dem Zusatz
**Video mit SMA-Musik**. SMA erkennt sie auch nach dem Umbenennen anhand des
abgeschlossenen Vertonungsauftrags, der Drive-Datei, der Größe und der SHA-256-Prüfsumme.

Für einen neuen Beitrag kann SMA die Produktangaben der zugehörigen Quellversion
verwenden. Das gilt auch für einen anschließenden Ausschnitt im Editor. Führt die
Zuordnung zu genau einem aktiven Artikel im öffentlichen Kundenshop, enthält der
gespeicherte Entwurf dessen direkten Produktlink. Bei fehlender oder mehrdeutiger
Zuordnung greifen die üblichen Regeln für die Textvorbereitung. Medienprüfung,
Titelbild und persönliche Freigabe beziehen sich weiterhin auf die gewählte Datei.

Der isolierte Test `node tests/run-gallery-background-sql.mjs` verfolgt einen
synthetischen stummen Clip durch die Vertonung bis zum gespeicherten YouTube-
und TikTok-Text. Er prüft außerdem den umbenannten Dateistand, den nachfolgenden
Editor-Export und die Ablehnung einer fremden oder veränderten Quelle.

### Hintergrundverarbeitung in n8n Cloud

Ein minütlicher Datenbank-Zeitplan löst den separaten Workflow
**SMA – Galerie – Automatische Vertonung V1** aus, wenn im Dateikatalog ein
verarbeitbarer Auftrag vorliegt. Eine leere Warteschlange erzeugt keinen
n8n-Aufruf. Ein Einmalticket bindet den Aufruf an den reservierten Auftrag.
Konto, Quellversion, Zugangsrechte zum Track und Kundenordner werden vor
dem Speichern geprüft. Die Musikfassung landet unter **02 Verarbeitung**.

Beim Einpflegen eines eigenen SMA-Masters wird die AAC-Datei einmal vorbereitet.
Der folgende Befehl benötigt Python, FFmpeg und ffprobe. Er verarbeitet die
Musik lokal, begrenzt die Lautstärke auf 25 Prozent und wiederholt einen kurzen
Master bis zur maximalen Cliplänge. Den ausgegebenen Pfad relativ zum
Ausgabeordner unter demselben Namen und mit MIME `audio/aac` im privaten
Bucket `sma-katalog` speichern:

```sh
python3 n8n/publishing/prepare-gallery-audio.py mein-master.wav ausgabe
```

Der Pfad lautet `render/<SHA-256 des Masters>/<SHA-256 der AAC-Datei>.aac`.
Die Zugriffsregel für Kunden gibt nur die freigeschalteten Original-Master
aus. n8n kontrolliert den Hash der vorbereiteten Datei. Für den Hintergrundweg
werden klassische, eigenständige MP4 mit einer H.264- oder HEVC-Bildspur
unterstützt. Vorhandene Audiospuren werden übersprungen. Bei stummen Videos
werden nur die benötigten AAC-Pakete eingesetzt. Die codierten Videodaten
sowie Orientierung und Zeitinformationen bleiben erhalten. Andere Container-
oder Spurvarianten werden der Browserprüfung überlassen. Nach einer
Ausgabereservierung bleibt die Verarbeitung an denselben Renderer und
dieselbe Upload-ID gebunden. Eine unterbrochene Übertragung wird am von
Drive bestätigten Byteoffset fortgesetzt. Nach fünf erfolglosen Versuchen
wartet eine bereits reservierte, ungeklärte Fassung auf Prüfung.

**Liveprüfung am 07.11.2026.** Um 18:27:00 Wiener Zeit startete der installierte
Zeitplan den veröffentlichten Workflow mit einem privaten Einmalticket für eine
synthetische MP4 und einen Testton. Um 18:27:02,938 lag der Beleg für die
erwartete Prüfsumme in der Datenbank vor. Die 49 Nodes, Verbindungen,
Credential-Referenzen und Einstellungen wurden mit dem Export der aktiven
n8n-Version `6c40bfd9-0446-486c-b660-d0982fe749de` abgeglichen.
Workflow-ID: `By3G8ESyl7yqViqa`. Produktive Ausführungsdaten werden im
Workflow weder bei Erfolg noch bei Fehler gespeichert. Für manuelle Testläufe
gilt der bestehende Instanzstandard.

Der reguläre Kundenpfad wurde mit den exportierten Nodes und den echten
SQL-Funktionen isoliert geprüft. Drive, die n8n-Kundentabelle und der
Storage-Transport wurden für diesen Test nachgebildet. Ein ab Byte 100
fortgesetzter Upload ergab genau eine verifizierte Galeriedatei. Am lokalen
Türgriff-Original war die codierte Bildspur bytegleich (241 Bilder, 10,041667 s);
die AAC-Tonspur dauert 10,042 s. Für die erste Live-Speicherung einer
Kundenfassung fehlt der erste produzierte SMA-Katalogmaster. Der private
Technikton ist dafür nicht freigeschaltet.

## Bedienung

- Tracks: Musik hinzufügen, suchen, anhören und zur Playlist hinzufügen.
  Fünf Einträge pro Seite; Playlist ist eine gespeicherte Favoritenauswahl.
- Editor → Ton → Gespeicherte Musik auswählen → Verwenden.
  Alternativ eine lokale Datei wählen und „Musik in Bibliothek speichern“.
- Der Entwurf enthält weiterhin die sechs vorhandenen Musikfelder. Beim
  erneuten Öffnen lädt der Editor die gespeicherten Originalbytes über deren
  SHA-256; Lautstärke und Startpunkt bleiben erhalten. Lokale, noch nicht
  gespeicherte Musik kann wie bisher erneut ausgewählt werden.
- Maximal 8 MB je Datei sowie 100 MB oder 100 Tracks je Kundenkonto.
  Der Export prüft zusätzlich tatsächlichen Codec, maximal zehn Minuten und
  höchstens zwei Audiokanäle. V1 enthält keinen fremden Lizenzkatalog und
  keine Lösch-/Umbenennungsfunktion. Nur Musik mit passenden Nutzungsrechten verwenden.

## Speicherung und Abgrenzung

- Privater Storage-Bucket `sma-musik`, Pfad `auth.uid()/sha256.wav|mp3`.
  Kein öffentlicher Link, keine signierte URL und keine Musikbytes in Rezepten.
- Privates Register `sma_private.music_library_v1`, RLS und keine direkten
  Tabellenrechte. Öffentlicher RPC `sma_music_library_v1` ist SECURITY INVOKER.
  Die privaten Definer prüfen UID und genau ein aktives, berechtigtes Kundenkonto
  bei jedem Zugriff; ihr search_path ist leer.
- Reservierung → unveränderlicher Upload ohne Upsert → Fertigstellung anhand
  endgültiger Storage-Größe und MIME. Storage prüft in der Vorprüfung
  `contentLength`, danach `size`; der Binär-Upload liefert eine eindeutige Länge.
- Identische Bytes werden pro Kunde dedupliziert. Wiederholung nach unterbrochener
  Antwort kann dasselbe Objekt fertigstellen. Reservierungen zählen zur Quote.
  Beim nächsten gültigen Uploadstart werden eigene, mehr als 24 Stunden alte
  Reservierungen ohne Storage-Objekt automatisch freigegeben. Vorhandene Objekte
  und fertige Tracks bleiben erhalten; Einzelheiten im folgenden Nachtrag.
- Der Server prüft Storage-Metadaten, nicht den Audioinhalt oder dessen Hash.
  Der Client verifiziert Größe und SHA-256 vor Anhören/Verwenden/Export;
  FFmpeg prüft beim Export die wirklichen Audiodaten.
- Restriktive Storage-Regeln verhindern fremden Zugriff, Überschreiben und
  Löschen auch bei später ergänzten allgemeinen permissiven Regeln.
- Abmeldung/Kundenwechsel und verworfene asynchrone Ergebnisse entfernen
  private Ansichten und lokale Objekt-URLs. Keine Token in URLs oder Logs.

## Technische Prüfungen

- 565 Node-Tests; 61 neue SQL-Prüfungen und sechs neue DOM-Szenarien bestanden.
- Bestehende Prüfungen: History-SQL 62/52/57/79/120, Export-SQL 105,
  History-DOM 29, Editor-DOM 11, Export-DOM 9, Musik/Cover-DOM 7 bestanden.
- Lokale Browserprobe: WAV hinzufügen → gespeicherten Track verwenden →
  Editor zeigt „bereit“ sowie Lautstärke 25 % und Start 0.
- Migration `20261106185329_music_library_v1.sql` installiert und Katalog geprüft:
  privater Bucket, fünf Storage-Regeln, RLS, kein anonymer RPC-Zugriff.
- Security-Advisor: bestehende Warnungen unverändert 4/6/1. INFO 41 → 42 wegen
  der absichtlich nicht direkt freigegebenen privaten Tabelle mit RLS ohne Policy;
  Zugriff ausschließlich über die geprüften Funktionen.

## Bereitstellung und echter Durchlauf

- PR #100 zusammengeführt, Feature `1fbb5d01559973f5b47f401a95bf9b626f395ff7`,
  Merge `2dc773d74b8fc6d6486d5e5eab61fde4d07ed4f8` auf `website-v1`.
  Beide PR-Prüfungen erfolgreich; Pages Run `42276275355`, Deployment-Job
  `128093526825` erfolgreich. Die zusätzliche Prüfung nach dem Merge ebenfalls grün.
- Im angemeldeten Dashboard echte WAV hochgeladen: selbst erzeugter neutraler
  660-Hz-Ton, eine Sekunde, 48 kHz mono, 96044 Bytes. Kein fremdes Musikmaterial.
  `SMA-Bibliothek-Techniktest.wav`, SHA-256
  `d45c1bdd447a842caeb04516b942a6e775fb863a5376b7be1fb05bf570a315ce`.
- Track `864f58cf-a303-45f0-952d-d7d14db70fbc`: Status `ready`, genau ein privates
  Storage-Objekt mit passender Größe/MIME. Identische Datei erneut hochgeladen:
  weiterhin genau ein Registereintrag und ein Objekt.
- Zur Playlist hinzugefügt, Kapitel gewechselt und Seite neu geladen: Auswahl
  bleibt erhalten. Entfernen leert nur die Playlist; Track bleibt verfügbar.
  Hörprobe erfolgreich geladen: eine Sekunde, readyState 4, kein Medienfehler.
- Neutrales Video `f8c861e2-d4ee-427a-9056-463ea56b4080` im Editor geöffnet,
  gespeicherte Musik gewählt, 26 % Lautstärke und Startpunkt 0,125 s gespeichert.
  Editor vollständig neu geladen: automatisch „bereit“, dieselben Einstellungen,
  kein erneutes Auswählen einer lokalen Datei nötig.
- Aus diesem wieder geöffneten Entwurf echte Browser-MP4 erzeugt und heruntergeladen:
  H.264/AAC, 320×240, drei Sekunden, 326332 Bytes, SHA-256
  `ab3a0c252bfb96813e4e038e0eec8d33ea4074787d92f7b755d6f89c80bf76cf`.
  Native Audioanalyse bestätigt Originalton (440 Hz) und Bibliotheksmusik (660 Hz):
  Amplituden bei 0,3 s 0,124310 / 0,025345; bei 2,2 s 0,124246 / 0,000037.
  Kürzere Musik endet, Video/Originalton laufen weiter.
- Testentwurf anschließend vollständig auf Standardwerte zurückgesetzt und
  gespeichert: Version 2, Datenbankvergleich mit Standardrezept `true`, nur die
  beiden Musikänderungen in der History. Playlist wieder leer; neutraler Track
  bleibt als Testdatei in der Bibliothek. Kein Export im Kundenordner gespeichert,
  kein zusätzlicher Provider-Auftrag und keine Social-Veröffentlichung.

## Weiterarbeit

Die eigene Musikbibliothek einschließlich erneutem Öffnen und Export ist abgeschlossen.
Die portalspezifische Cover-Übergabe für YouTube/TikTok ist technisch angeschlossen;
Prüfstand und verbleibende echte Providerbestätigung stehen in
[PORTAL_COVER_HANDOFF.md](PORTAL_COVER_HANDOFF.md).
Bestandsstrecke abgeschlossen; PR #57/#69 separat offen. Shopify-Testmodus
und unveröffentlichte n8n-Originalentwürfe erhalten. Keine Tarifänderung,
kein Kauf und keine Social-Media-Veröffentlichung.

## Leere Uploadreservierungen – 6. November 2026

Eine abgebrochene Übertragung konnte bisher dauerhaft einen der 100 Plätze bzw.
einen Teil der 100 MB reservieren. Der bestehende authentifizierte `prepare`-RPC
bereinigt jetzt nach Eingabe-/Kundenprüfung und unter der vorhandenen Kundensperre
nur Einträge mit `status=pending`, die **mehr als 24 Stunden** alt sind und für
deren exakten Pfad **kein** Objekt im Bucket `sma-musik` vorhanden ist. Die Quote
wird anschließend neu geprüft. Keine zusätzliche Aktion oder Zeitsteuerung nötig.

- Einzige betroffene Einträge: eigene leere Reservierungen der aktuellen
  Kundenzuordnung. Fertige Tracks, Playlist, fremde Kunden, aktuelle Uploads und
  jede vorhandene Storage-Zeile bleiben erhalten. Auch abweichende/unvollständige
  Objektmetadaten führen ausdrücklich nicht zum Löschen einer Reservierung.
- Ein vorhandenes Objekt ohne gespeicherte Abschlussantwort kann weiterhin über
  denselben unveränderlichen Pfad fertiggestellt werden. Ein leerer alter Versuch
  kann mit einer neuen Reservierung erneut gestartet werden.
- Der Storage-Schreibcheck nimmt dieselbe transaktionale Kundensperre wie der
  RPC. Seine Volatilität ist jetzt `VOLATILE`, damit er nach dem Warten den
  aktuellen Datenstand liest. Kommt der Upload zuerst, bleibt die Reservierung;
  kommt die Bereinigung zuerst, wird der verspätete ungebundene Upload abgewiesen.
  Danach kann der normale Uploadweg neu reservieren. Reine Leseprüfungen nehmen
  diese Sperre nicht.
- Keine Storage-Metadaten oder Audiodateien werden gelöscht oder verändert.
  Keine neuen Funktionen, Tabellen, Rechte, öffentlichen Endpunkte oder Dienste.
  Oberfläche, Schrift, Kapitel, Paginierung und vorhandene n8n-Entwürfe unverändert.

Quelle: `supabase/sql/music-library-reservations.sql`; identische Migration
`20261106205215_music_empty_reservations_v1.sql`. Sie ersetzt ausschließlich die
beiden vorhandenen privaten Funktionen und führt selbst keine Bereinigung aus.
Die bisherigen ACLs, UID-/Kundenprüfungen und leeren Suchpfade bleiben erhalten.

Prüfung: 575 Repository-Tests, 54 neue SQL-Fälle und 61 vorhandene
Musikbibliothek-SQL-Fälle bestanden.
Darunter beide Quotengrenzen, exakte Altersgrenze, Wiederholung, Kundenisolation,
inaktiver Zugang, unveränderte Objekte und Rollenrechte. Drei echte parallele
PostgreSQL-18.6-Szenarien mit getrennten Verbindungen bestanden: Upload zuerst,
Bereinigung zuerst und anschließende Wiederaufnahme. Alle Daten hierfür waren
synthetisch und lokal. CI prüft die Parallelfälle zusätzlich mit PostgreSQL 17.6.

Reproduktion:

```sh
node tests/run-music-library-reservations-sql.mjs
node tests/run-music-library-sql.mjs
npm ci --prefix tests/postgres-runtime --ignore-scripts
# Nur eine leere lokale Datenbank sma_music_reservation_test verwenden:
SMA_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/sma_music_reservation_test node tests/run-music-library-concurrency.mjs
```

Der native Test verweigert fremde Hosts, andere Datenbanknamen und bereits
vorhandene SMA-Testschema-Daten. Produktionsdatenbanken sind kein Testziel.
Primärgrundlagen: [Storage-Schema nur lesend verwenden](https://supabase.com/docs/guides/storage/schema/design)
und [PostgreSQL-Volatilität und aktuelle Snapshots](https://www.postgresql.org/docs/current/xfunc-volatility.html).

Die Migration ist im bestehenden Projekt installiert. Vor dem Austausch wurden
beide bisherigen Funktionshashes atomar geprüft; die anschließende Katalogabfrage
bestätigt den neuen Quellstand und unveränderte ACLs/Suchpfade. Der anonyme
RPC-Aufruf bleibt `AUTH_REQUIRED`, Security-Advisor-Kategorien unverändert.
Vor/nach: ein fertiger Track, keine offenen Reservierungen, ein Storage-Objekt;
Registerdigest `d3e0fad05f5720b8c6301664f331c5d1` und Objektdigest
`176e814873bb0f97a48a31dab64bae9e` unverändert. Es wurde kein echter Track
angelegt, geändert oder gelöscht. Die Bereinigungsfälle wurden nur lokal geprüft.
Alle neun Veröffentlichungsaufträge behalten Digest
`a19d817047175d3e2fe2315ff5f9b21b`; weiterhin null Operatorfreigaben,
Provider- und Coverversuche. Keine Änderung an Tarifen, Shopify oder n8n.

## Eigene SMA-Master vor Katalogfreigabe prüfen (08.11.2026)

Der **rein lokale, lesende Prüfweg** `n8n/publishing/verify-gallery-master.mjs`
kontrolliert einen zukünftigen Originalmaster und seine bereits vorbereitete AAC-Datei,
bevor ein Betreiber deren Verwendung im SMA-Katalog ausdrücklich genehmigt:

```sh
python3 n8n/publishing/prepare-gallery-audio.py /privat/master.wav /privat/ausgabe
node n8n/publishing/verify-gallery-master.mjs /privat/master.wav /privat/ausgabe/render/<MASTER_SHA256>/<AAC_SHA256>.aac
```

- Der Master muss aus exakt einem Audio-Stream bestehen, WAV/MP3 sein, maximal
  8 MB groß und höchstens zehn Minuten lang sein.
- Die vorbereitete Datei muss rohes AAC-LC mit 48 kHz Stereo sein, maximal
  1,5 MB umfassen und anhand dekodierbarer AAC-Frames die 60-Sekunden-Ausgabe
  abdecken. Eine bloß geschätzte ADTS-Containerdauer ist kein Prüfbeleg.
- Die AAC wird mit dem **aktiven SMA-Vorbereitungsprogramm** in einem temporären
  Verzeichnis neu erzeugt und bytegenau verglichen. Ein verfälschtes oder zu
  einem anderen Master gehörendes Sidecar wird abgelehnt.
- Ein Erfolg liefert nur den erwarteten, inhaltsadressierten Storage-Pfad,
  Prüfsummen, Größe und Dateiformat für die spätere **manuelle** Bereitstellung.

Der Befehl nimmt **keine Freigabe** vor. Er kann weder hochladen noch
`listed` setzen, Credits vergeben, Kaufen oder Veröffentlichen. Für eine
echte Freigabe sind die Qualität, Rechte, das korrekte eigene Musikstück
und eine ausdrückliche Betreiberentscheidung weiterhin erforderlich.
Kein Master, keine AAC und kein Kundentest wird durch das Repository
öffentlich gemacht.

Lokaler Vorlauf mit einem neu komponierten 32-Sekunden-Musikentwurf:
WAV und AAC technisch valide, erneutes AAC-Rendering bytegenau identisch,
manipulierte AAC korrekt zurückgewiesen. Drei unabhängige Unit-Tests
prüfen Hash-/Dateinamenbindung, Grenzen und AAC-Eigenschaften. Dies ist
**kein** Live-Katalogtest. Der erste freigegebene SMA-Musikmaster und der
anschließende echte Testkonto-Durchlauf fehlen weiterhin.

## Windows-AAC-Upload (09.11.2026)

Bei der erstmaligen Einpflege von **SMA Pulse 01** meldete der Windows-Browser
für den tatsächlichen, lokal dekodierbaren AAC-LC-/ADTS-Stream den MIME-Typ
`audio/vnd.dlna.adts`. Supabase Storage wies den korrekten Upload deshalb
mit HTTP 415 / `InvalidMimeType` zurück. Der bisherige Bucket erlaubte nur
`audio/aac`, `audio/mpeg` und `audio/wav`.

Die am 09.11.2026 als Migration `20261109105637_gallery_music_windows_aac_mime_compat_v1.sql` installierte, geprüfte Kompatibilitätskorrektur
`supabase/sql/gallery-music-windows-aac-mime.sql` lässt zusätzlich exakt
`audio/vnd.dlna.adts` im weiterhin privaten `sma-katalog`-Bucket zu.
Der Hintergrund-Dispatcher berücksichtigt diese zweite Schreibweise nur
für den bestehenden strikten Pfad `render/<master-sha>/<aac-sha>.aac`
und die unveränderte Grenze von 1,5 MB. Zugangsrechte, Trackfreischaltung,
Kundenbindung, Audio-Hash-Abgleich, Preise und Veröffentlichung bleiben unverändert.
Das ist **keine** automatische Musik- oder Veröffentlichungsfreigabe.

Der operative Test bleibt offen, bis genau eine AAC-Datei im korrekten Pfad
liegt und der gespeicherte Titel bewusst auf `listed=true` geschaltet wird.
Ein vorher fehlgeschlagener Upload darf nicht als vorhandenes Objekt gelten.

## Dashboard-Einbindung und Testmusik (09.11.2026)

Die Kapitel-Navigation legt für **Tracks**, **Meine Playlist** und **SMA-Musik**
eigene Bereiche an, kann deren früher erwartete festen Element-IDs jedoch
weglassen. Die Dashboard-Einbindung sucht daher zunächst die vorhandenen Hosts;
fehlen sie, ergänzt sie unter dem jeweiligen Kapitel einen eigenen Host,
**ohne** bereits vorhandene Formulare, Karten, Medien oder Listener zu ersetzen.
Beim Besitzerwechsel und Abbau werden diese zusätzlich angelegten Hosts entfernt.
Die DOM-Regression prüft alle drei Kapitel, den Kataloginhalt, den Erhalt der
Originalelemente und die vollständige Wiederherstellung.

**Operativer Unterschied:** Die Freigabe von **SMA Pulse 01** am 09.11.2026
ist ein **technischer Testtitel**, keine endgültige Kunden-Musikauswahl.
Vier weitere Demo-Kompositionen bleiben privat in Google Drive und werden
nicht in den SMA-Katalog aufgenommen. Die später gelieferten offiziellen
Musiktitel werden separat geprüft und erst mit ausdrücklicher Freigabe
bereitgestellt. Weder ein bestätigter Live-Kundendurchlauf der automatischen
Galerievertonung noch ein echter Musikkauf wird durch diese UI-Korrektur
behauptet. Die Paketregeln Delta inklusive und Alpha/Beta Credits bleiben bestehen.

## Erster realer Galerie-Vertonungsdurchlauf (09.11.2026)

**Status:** Technischer Kunden-End-to-End-Lauf in `kunde_3182` erfolgreich,
Hörprobe im angemeldeten Dashboard noch offen. Diese Prüfung ersetzt die
historischen offenen Hinweise oben hinsichtlich der **ersten gespeicherten
Kundenfassung**, nicht die später geplante Bedien-/Hörprüfung.

- Das aktive Delta-Testkonto lud ausschließlich über das bestehende Dashboard
  `Datei hinzufügen` den **eigenen stummen 10-Sekunden-MP4-Testclip** hoch:
  `SMA_STUMMER_GALERIE_TEST_10S_2026-11-09.mp4`.
- In `sma_private.publication_uploads_v1` steht **completed**; der
  Datei-Katalog `sma_private.publication_files_v1` enthält das unveränderte
  Original: Asset `d24864ab-8743-46ed-9067-2eebae35ccac`, 1.951.847 Bytes.
- Der n8n-/Galerie-Musik-Pfad erzeugte mit dem **nur für Techniktests
  freigeschalteten Titel SMA Pulse 01** genau einen Auftrag in
  `sma_private.gallery_music_v1`:
  `1b6d8375-b104-4a13-a1ec-4428ddb52383`, `state=completed`,
  `failures=0`, `background_skip=false`.
- Zugehöriger Titelmaster: SHA-256
  `f1f5743d415dddff2ed9e36fbf1836acba22d1f28e2df345291bd84fb1137e89`.
  Vom Prozess gebundener erwarteter Ergebnis-Hash:
  `aa4f169c20be5b1a1f5a1916d93bb516745f190f5523ddf69a1e8b5f91747074`.
- Die zurückgemeldete fertiggestellte Version
  `SMA_STUMMER_GALERIE_TEST_10S_2026-11-09 – mit SMA-Musik.mp4`
  wurde in Drive übernommen und mit abgeschlossenem Upload im Dateikatalog
  registriert: `result_id=48755463-b8c9-4519-9adb-b4877883dc58`,
  **2.125.747 Bytes**, `available=true`. Genau **ein** solcher
  Ergebnisdatensatz und genau **eine** Ziel-Drive-ID wurden gezählt;
  es gab keinen zweiten Ergebnisauftrag.
- `sma_private.music_track_unlocks_v1` enthielt weiterhin **0** Zeilen:
  kein Musikguthaben durch den Delta-Test verbraucht.
- Zeitpunkt der Auftragsanlage laut PostgreSQL:
  **09.11.2026 12:58:02 UTC**, Ergebnis-Upload fertig:
  **12:58:13 UTC**. Die Vorgänge erfordern kein dauerhaft offenes Dashboard;
  der aktive Cron `sma-gallery-soundtrack-v1` läuft minütlich.

**Abgrenzung:** Die Datenbank- und Upload-Nachweise bestätigen Speicherung,
Idempotenz und technischen Abschluss, aber **noch keine unabhängige visuelle
oder akustische Wiedergabeprüfung der erzeugten MP4**. Deshalb das fertige
Video im angemeldeten Dashboard explizit öffnen und die Tonspur anhören.
Keine Social-Media-Veröffentlichung, kein Provider-/Cover-Abnahmeversuch und
kein Kauf wurden ausgeführt. Der Testtitel bleibt provisorisch; die vier
anderen privaten Demos wurden nicht in den SMA-Katalog aufgenommen.
Die neun vorhandenen Veröffentlichungsaufträge sind kein Teil dieser
Galerie-Prüfung und dürfen unverändert bleiben. PR #57/#69 separat offen.
