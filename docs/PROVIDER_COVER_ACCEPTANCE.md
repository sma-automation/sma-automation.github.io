# Vorbereitung der echten Provider-/Coverabnahme

Stand: 07.11.2026 (Wien). **Noch keine Uploadfreigabe und kein uploadbereiter
Auftrag.** Diese Vorbereitung wurde ausschließlich lesend und lokal ausgeführt.
Sie ersetzt keine persönlichen Erklärungen und keine gespeicherten Mediennachweise.

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

## Tatsächlich geprüft

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

## Passender Testtext, noch nicht im Portal gespeichert

Titel: **SMA-Cover-Test: Rotes Tür-Zusatzgerät**

Beitrag: **Technischer Test mit einem drei Sekunden langen Ausschnitt. Zu sehen
sind eine Hand an einer verchromten Türklinke und das Ansetzen eines roten
Tür-Zusatzgeräts.**

Dieser Text enthält keine Aussage über Abnehmen, Verstauen oder Schutzwirkung.
Die Texte des vollständigen Originals dürfen nicht ungeprüft übernommen werden.
Ein Shop-Link würde durch den regulären Kundenweg ergänzt und gehört vor der
Freigabe zur vollständigen Beitragsprüfung; er wird hier nicht erfunden.

## Nächster ausführbarer Schritt und Grenzen

1. Für genau diesen Export den passenden Portalentwurf speichern und die
   revisionsgebundenen technischen Nachweise sowie den Portaltextvergleich über
   einen tatsächlich verfügbaren Prüfweg erzeugen. Die bestehende automatische
   Videoanalyse verwendet die vorhandene OpenAI-Anbindung; sie ist kein neu
   eingerichteter, kostenloser Prüfdienst. Hier wurde sie nicht aufgerufen.
2. Erst danach das aktuelle Zielkonto samt erlaubten Optionen lesen und den
   konkreten Auftrag vorbereiten. Alte Kontonachweise aus stornierten Aufträgen
   sind keine frische Zielkontobestätigung.
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

Die reine Uploadfreigabe wäre für den Kurzexport heute noch nicht ausreichend:
eigener Portaltext und gespeicherte technische/inhaltliche Belege fehlen ebenfalls.
Die neun bestehenden Aufträge bleiben unverändert. Keine Operatorberechtigung,
kein Provider- oder Coverversuch. PR #57/#69, n8n-Originalentwürfe und
Shopify-Testmodus bleiben unangetastet.
