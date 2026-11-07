# Vorbereitung der echten Provider-/Coverabnahme

Stand: 07.11.2026 (Wien). **Noch keine Uploadfreigabe und kein uploadbereiter
Auftrag.** Die erste Sichtung aus PR #118 erfolgte lokal. Der Speicherstand folgt unten.
Sie ersetzt keine persönlichen Erklärungen und keine gespeicherten Mediennachweise.

## Aktueller Stand der Abnahme

Der private YouTube-Test für den Drei-Sekunden-Export wurde am 07.11.2026
um 11:57 Uhr (Wien) vorbereitet. Die Türszene wurde laut Kundenangabe mit
Runway erzeugt. Im Auftrag stehen „synthetische Inhalte“ auf Ja und „speziell
für Kinder“ auf Nein. Die Kontoprüfung lief um 12:02 Uhr ab. Für einen später
ausdrücklich freigegebenen Versuch müssen Zielkonto und Einstellungen erneut
geprüft werden. Die persönliche Prüfung, Rechtebestätigungen und die
Veröffentlichungsfreigabe stehen aus. Eine Providerbestätigung liegt weiterhin aus.

History und Auftragsdialog zeigen die Gültigkeit der Vorbereitung an. Maßgeblich
ist die frühere der beiden Fristen für Auftrag und Kontoprüfung. Ein Neustart im
Dialog lädt die Kontooptionen. Erst „Auftrag prüfen“ bereitet einen neuen Auftrag vor.

Die beiden Werbeentwürfe am Zehn-Sekunden-Original wurden anhand der vorhandenen
241 Einzelbilder und des vom Kunden beschriebenen Produktzwecks geprüft.
Am Anfang berührt ein Finger die Metallklinke. Das Öffnen ausschließlich mit
dem roten Griff ist im geschnittenen Clip nicht eindeutig belegt. Die damaligen
Textstände erhielten je einen konkreten Hinweis. Die korrigierten Texte
beschreiben Ansetzen, Abnehmen und Verstauen. Sie nennen das Hotel als
vorgesehenen Einsatzort.

YouTube und TikTok stehen jeweils auf Textrevision 4 (Dateizuordnung 6 und 4).
Beide regulären Medienprüfungen melden `PORTAL_TEXT_COMPARISON=pass`.
Der Prüfstand `assisted_video_and_product_facts` kennzeichnet die Assistenzsichtung.
Die interne Vergleichsfunktion bindet den Text, die gespeicherten Video-Beobachtungen
und ein für das Kundenkonto anhand der SHA-256-Prüfsumme eindeutig bestätigtes
Produktprofil. Änderungen an diesen Eingaben erfordern einen neuen Vergleich.
Für diese Abnahme wurde kein externer Analyseaufruf gestartet. Zehn bestehende
Aufträge, null Freigaben, Operatorberechtigungen, Provider- und Coverversuche.

## Zwei unterschiedliche Dateien

Die Assistenzsichtung aus [PR #117](https://github.com/sma-automation/sma-automation.github.io/pull/117)
betraf das unveränderte Original: 10,041667 Sekunden, 241 Bilder, keine Tonspur.
Die vorhandenen YouTube-/TikTok-Texte passen zu dessen vollständigem Ablauf.
Das Original hat selbst kein gebundenes Exportcover.

Für die Coverabnahme kommt der bereits abgeschlossene Export
`283abd16-3b72-4224-ab66-81b30afdab13` infrage. Er enthält nur die ersten drei
Sekunden desselben Tür-Zusatzgerät-Videos, zusätzlich mit dem damaligen Testton.
Er ist **nicht** die separate neutrale Datei `SMA-Musik-Cover-Techniktest.mp4`.
Original, Export und neutrale Testdatei dürfen nicht verwechselt werden.

| Eigenschaft | Vorhandener Cover-Testexport |
| --- | --- |
| Video | `a85fa4cc-b4d9-4998-b97d-e399b74d30ba` |
| Dateirevision | `sha256:863f7af8215231381a0431b7ab4d6b831a974f92001eace2a8e45f24f51592ed:10` |
| Größe | 938425 Bytes |
| Tatsächliche Videolänge | 3,000000 Sekunden; Drive meldet gerundet 2999 ms |
| Videoformat | H.264 / yuv420p, 720 × 1280, 30/1 Bilder/s |
| Vollständig dekodiert | 90 Bilder; keine Dekodierfehler |
| Audio | AAC-LC, 44100 Hz, mono, 3 Sekunden |
| Zugeordnetes PNG | `d010523a-c338-4b8f-a53f-fe60875c1e9a` |
| Coverrevision | `sha256:0c85f685e4332544c080b5c9fe6375b74b06f50568f1f98fcb2538647ece7d7b:2` |
| PNG laut gespeichertem Export/Katalog | 465264 Bytes, 720 × 1280 |
| Gewählter Bildzeitpunkt | 1000 ms im fertigen Video |

## Erste Sichtung aus PR #118

- Die vorhandene angemeldete Vorschau lud den Export über den bestehenden
  Editor-Quellweg. Die heruntergeladenen Videobytes stimmen in Größe und SHA-256
  mit dem abgeschlossenen Export überein. Keine Analyse, Speicherung oder
  Veröffentlichung wurde dadurch ausgelöst.
- FFmpeg dekodierte alle 90 Videobilder und die Audiospur. Alle Videobilder
  wurden als Bildfolge gesichtet: Hand/Klinke, Ansetzen des roten Zusatzgeräts,
  erneute Betätigung der Klinke. Das spätere Abnehmen und die schwarze Tasche
  sind in diesem kurzen Ausschnitt nicht zu sehen.
- In 0,1–1,3 s liegen 99,9984 % der gemessenen spektralen Energie im Bereich
  875–885 Hz (Maximum 880 Hz). In 1,7–2,9 s sind die dekodierten Audiowerte null.
  Das passt zum gespeicherten 1,5-s-Testton bei 25 % Lautstärke. Diese Messung
  ist kein Transkript und keine Bestätigung von Musik-/Nutzungsrechten.
- Die authentifizierte Cover-Vorschau zeigt das zugeordnete Bild bei Sekunde 1.
  Heruntergeladen wurde dabei das verkleinerte Vorschaubild. Es ist **kein**
  Byte-/Hashnachweis der ursprünglichen PNG; dessen exakte Prüfung bleibt im
  vorhandenen Provider-Coverpfad unmittelbar vor dem Versand erforderlich.
- Im Portal sichtbar: für diesen Export noch kein gespeicherter Beitragstext
  und kein vollständiger technischer Analysebeleg. Die lokalen Messungen wurden
  nicht in einen Maschinenbefund oder eine Kundenselbstauskunft umgeschrieben.

Private Videobytes, Audiodaten, Einzelbilder und Vorschaubilder werden nicht
im öffentlichen Repository gespeichert. Es wurde kein kostenpflichtiger
Analyseaufruf ausgelöst.

## Gespeicherter Testtext für YouTube und TikTok

Titel: **SMA-Cover-Test: Rotes Tür-Zusatzgerät**

Beitrag: **Technischer Test mit einem drei Sekunden langen Ausschnitt. Zu sehen
sind eine Hand an einer verchromten Türklinke und das Ansetzen eines roten
Tür-Zusatzgeräts.**

Dieser Text enthält keine Aussage über Abnehmen, Verstauen oder Schutzwirkung.
Die Texte des vollständigen Originals dürfen nicht ungeprüft übernommen werden.
Die gespeicherte Caption enthält den Shop-Link des zugeordneten Kundenkontos.

## Speicherstand vom 07.11.2026

Beide Portale lesen ihren eigenen Entwurf in Revision 1 für die aufgeführte
Dateiversion. Die Texte wurden als Assistenzentwürfe administrativ importiert.
Der Import prüfte den frischen Katalogeintrag, den abgeschlossenen Export, die
aktive Kundenzuordnung und den aktuellen Shop. Die bestehende Vorschaufunktion
speicherte jeden Entwurf. Die Rückgabe der regulären Zuordnungsfunktion
bestätigte für beide Portale die vollständige Caption.

Das vorhandene Programm `n8n/publishing/video-extract.py` dekodierte lokal
die geprüften MP4-Bytes. Die Messwerte und die Herkunft der Sichtbeobachtungen
sind am privaten Export gespeichert. Die Medienprüfung beider Portale meldet
`BINARY_INSPECTION=pass`. TikTok bestätigt zusätzlich Codec, Bildrate und
Abmessungen. Die Bildabstände liegen zwischen 33333 und 33334 Mikrosekunden.

Migration `20261107100847_publication_export_probe_v1.sql` ergänzt den
Leseweg für abgeschlossene Exporte. Er bindet Messwerte an Kunde, Eigentümer,
Dateirevision, Bytezahl und Prüfsumme. Die privaten Schreibrechte liegen beim
Administrator. Neue und bestehende Magic-Effect-Ergebnisse behalten ihren
eigenen Prüfweg. Der lokale Messweg besteht unabhängig von einer Transkription.

## Kontoprüfung und Original-Cover am 07.11.2026

Im angemeldeten SMA-Kundenbereich wurden die aktuellen Kontoprüfungen für
denselben 3-s-Export einzeln geöffnet. Der YouTube-Dialog zeigte den verbundenen
Kanal und die Option **Privat**. TikTok gab **Nur ich**, **Freunde** und
**Follower** sowie ein Videolimit von 3600 Sekunden zurück. Duette und Stitch
waren kontoseitig deaktiviert. Beide Beitragsvorschauen enthielten den gespeicherten
Testtext und den zugeordneten Shop-Link. Diese Beobachtungen gelten für den
Zeitpunkt der Prüfung. Die Freigabe prüft das Zielkonto erneut.

Im Editor wurde die vorhandene PNG über **Export → Gespeicherte Ergebnisse →
Cover herunterladen** abgerufen. Die Datei ist als PNG mit 720 × 1280 Pixeln
vollständig lesbar. Die 465264 Bytes stimmen in SHA-256 mit der oben aufgeführten
Coverrevision überein. Der bestehende Cover-Adapter validierte die Originalbytes
gegen den aktuellen, lesend berechneten Coverplan. Der Plan verwendet 1000 ms
bei einer Exportdauer von 3000 ms. Der Katalogabruf im Portal war um 11:52 Uhr
(Wien) erfolgreich. Die Abschlussabfrage ergab neun bestehende Aufträge, null
Operatorfreigaben, null Provider- und null Coverversuche.

Für den ersten privaten YouTube-Test wurde die Zielgruppe des technischen Tests
als „nicht speziell für Kinder“ vorgemerkt. Die Pflichtangabe zur realistischen
Veränderung bzw. synthetischen Herkunft der Türszene ist offen. Der gespeicherte
Testton belegt allein die Entstehung der Tonspur. Für TikTok ist vor einer
Auftragsvorbereitung die zutreffende Werbekennzeichnung des Beitrags zu klären.

## Ablauf der Abnahme und damaliger Prüfstand

1. Automatischer Textvergleich abgeschlossen. Die beiden gespeicherten Entwürfe
   in Revision 1 stimmen in Titel, Text, Hashtags und vollständiger Caption mit
   der unabhängig bei der Sichtung des Kurzexports dokumentierten Referenz
   überein. Der Vergleich schließt den Shop-Link ein. Die reguläre Auftragsprüfung
   liefert für beide Portale `PORTAL_TEXT_COMPARISON=pass`. Die Referenz ist an
   die vollständige lokale Messung und die Sichtbeobachtungen gebunden. Eine
   Abweichung im Text erfordert eine neue Prüfung. Die Methode erfasst exakt
   bekannte Formulierungen. Persönliche Inhalts- und Rechteerklärungen stehen aus.
2. Die Herkunft der Türszene klären und die zutreffende YouTube-Kennzeichnung
   im privaten Testauftrag setzen. Bei der Vorbereitung das Zielkonto frisch prüfen.
3. Kundenseitige Inhalts-/Rechtebestätigungen und die ausdrückliche Freigabe
   dieses konkreten Tests einholen. Die Assistenzsichtung bestätigt nicht, dass
   der Kunde selbst alle persönlichen Prüfaussagen erfüllt hat.
4. Vorgeschlagener Abnahmeumfang: zuerst ein YouTube-Upload mit **Privat**, danach
   ein separat freigegebener TikTok-Test mit **Nur ich**, sofern Konto und
   erforderliche Kennzeichnungen diese Einstellung erlauben. Niemals automatisch
   auf öffentlich ausweichen. Keine Veröffentlichung ist hiermit genehmigt.
5. Die gesonderte Operatorberechtigung erst für den tatsächlich freigegebenen,
   unveränderten Auftrag setzen. Bestehenden Dispatcher verwenden, keine alten
   Publisherknoten aktivieren. Bei unklarem Ergebnis keinen Neuversand starten.
6. YouTube: Videoverarbeitung und PNG-Antwort getrennt nachweisen. TikTok:
   Videoabschluss und übergebenen Bildzeitpunkt nachweisen; daraus keine
   unabhängig bestätigte Coverdatei ableiten. History anschließend lesen.

Migration `20261107102147_publication_export_reference_v1.sql` ist installiert.
Die damalige Frage zur Medienkennzeichnung wurde inzwischen durch die Runway-Angabe geklärt.
Die neun bestehenden Aufträge bleiben unverändert. Keine Operatorberechtigung,
kein Provider- oder Coverversuch. PR #57/#69, n8n-Originalentwürfe und
Shopify-Testmodus bleiben unangetastet.

## Produktangaben für neue Textentwürfe

Die Portaloptimierung kann eine kundenseitig bestätigte Produktbeschreibung mit dem
Dateiinhalt kombinieren. Eine bestätigte SHA-256-Zuordnung gilt auch für abgeschlossene
Editor-Exporte, wenn Dateistand, Größe, Prüfsumme und Kundenkonto zusammenpassen.
Weitere Artikel lassen sich anhand des vollständigen Dateinamens ohne Endung oder
einer lesbaren Aufschrift einem aktiven Katalogartikel zuordnen. Verglichen werden
Produktname, SKU und SMA-Artikelnummer. Mehrere Treffer führen beim Magic Effect
zur Rückfrage im vorhandenen Beschreibungsfeld.

Bei einem vollständig gesichteten Export kann der Magic Effect die gespeicherte
Bildbeschreibung verwenden. Produktzweck und Themengebiet stammen aus den
Produktangaben. Ein neuer Text durchläuft weiterhin den regulären Inhaltsabgleich.
