# Galerie: laufende Vorschaubilder bei Neuzeichnen wiederverwenden

Stand: 16. November 2026. Ausgangsstand: `website-v1` bei
`502f57cf36348ca0adce3e120f04159dbae64a7f`.

## Nachgewiesener Verbrauchsfehler

Die Dateigalerie im Dashboard (`draw` in `app/dashboard.html`) und die
Dateiauswahl im Optimierer (`renderFilePicker` in
`app/assets/publication-preview.js`) rufen beim Neuzeichnen zuerst
`thumbnails.reset()` beziehungsweise `pickerThumbnails.reset()` auf. Danach
melden sie die weiterhin angezeigten Dateien synchron erneut mit `observe()` an.
Suche, Filter, Seitennavigation und Auswahl können diesen Ablauf auslösen.

Bisher brach `reset()` auch schon gestartete Vorschaubild-Anfragen ab. Solange
deren Antwort noch nicht im Cache war, löste dieselbe unveränderte Datei im
neuen DOM einen weiteren Webhook-POST aus. Der Abbruch im Browser verhindert
keinen n8n-Start, den der Server bereits angenommen hat.

Die neue Regression wurde vor dem Fix gegen den Ausgangscode ausgeführt und
schlug mit `actual: 4`, `expected: 1` fehl. HTTP-Antworten, Authentifizierung und
Bilddaten stammen vollständig aus lokalen Test-Fixtures.

| Genau geprüfter Ablauf | Vorher | Nachher |
| --- | ---: | ---: |
| Eine langsame Vorschau derselben Datei und Revision, danach drei Neuzeichnungen bei weiterhin sichtbarer Datei | 4 POSTs | 1 POST |
| Bild nach Freigabe der angehaltenen Antwort | Ergebnis nur im letzten DOM zulässig | 1 Bild im letzten DOM, 0 Bilder in den drei alten Hosts |

Damit entfallen in diesem Szenario drei zusätzliche POSTs. Der Test misst keine
monatliche Gesamtersparnis. Die separat erhobenen 489 Vorschaubild-Ausführungen
vom 9. bis 16. November sind eine Gesamtzahl; welcher Anteil davon durch diesen
Fehler entstand, ist unbekannt.

## Verhalten nach der Änderung

- Ein Loader teilt laufende Arbeit anhand von Datei-ID, Revision und Medienart.
  Auch mehrere aktuelle Hosts derselben Datei verwenden nur eine Anfrage.
- Ein Neuzeichnen trennt die alten DOM-Hosts ab und widerruft ihre Objekt-URLs.
  Nach der synchronen Neuanmeldung bleiben nur Anfragen für weiterhin angezeigte
  Dateien erhalten. Die Übergabe funktioniert auch, wenn der neue
  `IntersectionObserver` erst später meldet, dass der Host sichtbar ist.
- Dateien, die aus der Ansicht verschwinden, verlieren ihre vorgemerkten Jobs;
  laufende, nicht mehr benötigte Jobs werden abgebrochen. Andere Dateien können
  danach ihre Plätze nutzen.
- Es laufen höchstens drei unterschiedliche Anfragen gleichzeitig. Die
  gemeinsame Frist von 45 Sekunden für Token, HTTP und Antwortkörper beginnt
  durch ein Neuzeichnen nicht erneut. Nach einem Fehler oder Fristablauf kann
  eine spätere ausdrückliche Neuanmeldung einen neuen Versuch starten.
- `clear()` bricht alle Jobs ab und leert den Cache. Alte Antworten können nach
  Logout oder Besitzerwechsel weder den neuen DOM noch den neuen Cache füllen.
  Revisionen werden getrennt behandelt. Der vorhandene Speicher-Cache bleibt
  bei höchstens 20 Antworten und 60 Sekunden Gültigkeit.

Die beiden Galerie-Einstiegspunkte laden das Thumbnail-Modul mit `v=3`;
die Optimierer-Seite lädt ihr Skript mit `v=103`. Die Dashboard-Einbettung
verwendet die Seitenversion `v=52`. Der eigenständige Vorschaubildabruf des
Medieneditors wurde nicht verändert.

## Gezielte Prüfung

```sh
node --test tests/asset-thumbnail-timeout.test.cjs
node --test --test-name-pattern='professional preview places only publication in the primary action host' tests/optimizer-workspace.test.cjs
node --check app/assets/asset-thumbnail.mjs
node --check app/assets/publication-preview.js
git diff --check
```

Die Thumbnail-Suite besteht lokal mit **19 erfolgreichen Tests**, ohne Fehler.
Ihr bereits vorhandener optionaler Desktop-/Mobil-Browsertest wird lokal wegen
der nicht installierten Browser-Abhängigkeit übersprungen. Die gezielten Fälle
decken zusätzlich zu der 4-zu-1-Regression gemeinsame Hosts und die
Drei-Anfragen-Grenze, verzögerte Observer-Callbacks, unveränderte Deadline und
erneuten Versuch, Revisionwechsel sowie `clear()` mit Besitzerwechsel und
verspäteter alter Antwort ab. Vorhandene Tests für blockierte Token-/HTTP-/JSON-
Lesevorgänge, weggewechselte Seiten, Cache-Löschung und strikte
Antwortvalidierung bleiben erhalten.

Für diese Änderung wurden keine produktiven Webhooks aufgerufen, keine
Kundendaten geändert, keine Dateien hochgeladen und keine Beiträge veröffentlicht.
