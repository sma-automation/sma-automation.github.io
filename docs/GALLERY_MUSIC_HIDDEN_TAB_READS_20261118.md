# Galerie-Musik: Hintergrund-Tabs ohne wiederholte Leerlaufabfragen

Stand: 18.11.2026. **Browser-Kostenkorrektur, keine zusätzliche
Medien- oder Providerfreigabe.**

## Tatsächlicher Ausgangsbefund

Ein rein lesender 24-Stunden-Auszug der Supabase-Edge-Zugriffsprotokolle
ergab für `/rest/v1/rpc/sma_gallery_music_v1`:

| HTTP-Methode | Browser-Anfragen |
| --- | ---: |
| POST | 63 |
| OPTIONS (CORS-Vorabfrage) | 63 |

**63 POSTs sind 63 eigentliche RPC-Anfragen**, nicht 126 gestartete
Musikjobs und insbesondere **keine 63 abgerechneten n8n-Ausführungen**.
Welche POSTs auf die einzelnen RPC-Aktionen entfielen, wurde aus diesen
Logeinträgen nicht festgestellt. Das tatsächliche Einsparvolumen kann
erst mit vergleichbaren Nachher-Protokollen bestimmt werden.

Der Browser-Worker in `app/assets/gallery-music-worker.mjs` fragte
bei leerer Warteschlange bislang alle 120 Sekunden erneut nach einem
Auftrag, bei einem belegten Konto alle 60 Sekunden und ohne
verfügbaren Track alle 15 Minuten. Auch ein im Hintergrund laufender
Browser-Tab behielt seine Leerlauf-Timer.

## Änderung

Solange `document.hidden === true` ist, wird

- eine geplante **Leerlauf-Abfrage** abgesagt;
- auch ein anderweitig ausgelöstes `wake()` nicht als neuer
  `claim`-RPC gestartet;
- bei Rückkehr zum sichtbaren Tab genau ein frischer Auftragabruf
  ausgelöst;
- ein **bereits beanspruchter** Musikauftrag weiterhin unter seiner
  bestehenden Lease und Upload-ID zu Ende geführt, samt bestätigtem
  Transfer/Receipt. Nach seinem Abschluss wird im ausgeblendeten
  Tab **kein neuer Auftrag** beansprucht.

Der bereits vorhandene, separat zeitgesteuerte n8n-Musikablauf
(`sma-gallery-soundtrack-v1`) bleibt unverändert und kann weiterhin
ohne geöffneten Browser arbeiten. Die bestehende
Kunden-, Track-, Quellrevision-, Audio- und Uploadprüfung wird nicht
umgangen. Es werden keine Titel gekauft, Dateien veröffentlicht oder
zusätzliche Workflows gestartet.

## Wiederholbare Prüfung

```sh
node --test tests/gallery-music.test.cjs
```

Neue isolierte Tests überprüfen den Leerlauf-Timer, das Aufwachen,
den zunächst verborgenen Tab, die saubere Beendigung einer laufenden
Lease und das Unterbleiben des nächsten `claim`.
Die Tests verwenden ausschließlich synthetische Video- und
Datenbankantworten. Sie messen **keine Live-Einsparung** und
ersetzen weder die vollständige Kundenton-Abnahme noch die
echte Google-Drive-Berechtigungsprüfung.

Die Änderung spart nur tatsächlich überflüssige **Browser-RPCs**,
keine automatisch nachgewiesenen kostenpflichtigen n8n-Executions.
