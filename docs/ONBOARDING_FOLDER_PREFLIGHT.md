# Kundenordner vor der ersten Buchung prüfen

Stand: 16. November 2026. Rein lesendes Betreiberwerkzeug; **keine Kunden-,
Zahlungs-, Upload- oder Veröffentlichungsfreigabe**.

## Zweck

Zwei gespeicherte Ordner-IDs allein beweisen nicht, dass der Dateiweg nutzbar
ist. `n8n/package-payment/check-folders.mjs` prüft mit höchstens drei
Metadaten-GETs beim festen Google-Drive-Endpunkt:

1. Die angemeldete Drive-Identität entspricht der vorher bestätigten
   `permissionId` der von SMA tatsächlich verwendeten Verbindung.
2. `upload_folder_id` ist ein vorhandener, nicht gelöschter Ordner mit
   `canListChildren=true` **und** `canAddChildren=true`.
3. `processing_folder_id` ist ein anderer vorhandener, nicht gelöschter Ordner
   mit `canListChildren=true` und `canAddChildren=true`.
   Fehlendes oder bloß als Text zurückgegebenes `canAddChildren` wird bei
   **beiden** Ordnern als nicht nachgewiesenes Schreibrecht behandelt.

Es werden weder Ordnerinhalte aufgelistet noch Medien heruntergeladen. Es
werden keine Ordner erstellt, Berechtigungen geändert, Webhooks aufgerufen,
Zahlungen angelegt oder Kundendaten geschrieben. My Drive und geteilte Ablagen
werden mit `supportsAllDrives=true` unterstützt. Das Werkzeug ist kein neuer
n8n-Workflow und wird nicht automatisch ausgeführt.

## Voraussetzungen und Aufruf

Die eindeutige Kontozuordnung bleibt im
[Startcheck](SMA_LAUNCH_READINESS_20261201.md) beschrieben. Beide Ordner-IDs aus
**derselben bereits geprüften SMA_Kunden-Zeile** verwenden. Der Eingang ist
`01 Upload – Eingang`, der Verarbeitungsordner `02 Verarbeitung`.

In einer privaten Betreiberumgebung mit Node.js 22 oder neuer müssen zwei
Umgebungsvariablen eingerichtet sein:

- `SMA_GOOGLE_DRIVE_READ_TOKEN`: kurzlebiger OAuth-Zugriffstoken der tatsächlich
  für SMA eingerichteten Drive-Verbindung; kein Refresh-Token.
- `SMA_GOOGLE_DRIVE_EXPECTED_PERMISSION_ID`: zuvor unabhängig bestätigte
  `user.permissionId` genau dieser Verbindung. Ein beliebiger persönlicher
  Drive-Zugang genügt nicht. Die erwartete Identität nicht aus dem gerade zu
  prüfenden, unbekannten Token ableiten, um eine Fehlzuordnung zu übergehen.

Zugangsdaten nicht in den Chat, ins Repository, in Befehlsargumente oder in
Protokolle kopieren. Das Werkzeug fordert keine erweiterten Rechte an und
aktualisiert keine Tokens. Bei fehlender bestätigter Verbindung nicht starten.

```sh
node n8n/package-payment/check-folders.mjs UPLOAD_ORDNER_ID VERARBEITUNGS_ORDNER_ID
```

Die beiden Platzhalter durch die gespeicherten IDs ersetzen. Die Ausgabe
enthält ausschließlich Prüfcodes, Prüfzeit und feste Wahrheitswerte; keine
Ordner-IDs, Kundendaten, Drive-Kennung oder Tokens. Erfolg liefert Exit-Code 0,
ein Fehler Exit-Code 1. HTTP-Antworten, Fehlertexte und zusätzliche
Anbieterfelder werden nicht ausgegeben.

## Ergebnis richtig einordnen

`FOLDER_ACCESS_VERIFIED` bestätigt ausschließlich die soeben gelesenen
Metadaten und die zu diesem Zeitpunkt gemeldeten Berechtigungen dieser
Drive-Identität. Die Ausgabe enthält ausdrücklich:

```json
{
  "allows_payment": false,
  "allows_upload": false,
  "activates_customer": false,
  "customer_assignment_verified": false
}
```

Die Zugehörigkeit der Ordner zum richtigen Kunden, die unveränderte
SMA_Kunden-Zuordnung und die tatsächlich installierte n8n-Verbindung sind
zusätzlich zu prüfen. Google-Berechtigungen können sich später ändern.
Das zusätzlich geforderte `canAddChildren=true` beim Eingangsordner ist
eine **konservative Betreiberprüfung der SMA-Drive-Identität**, kein Beweis
für das Schreibrecht einer möglicherweise anderen, angemeldeten
Kundenidentität. Auch nach einem positiven Prüfergebnis muss der reale
Kunden-Upload- und Weiterverarbeitungsweg gesondert getestet werden.
`canAddChildren=true` ist kein Beweis für erfolgreiche Dateiübertragung,
verfügbaren Speicher, das Entfernen oder Verschieben bereits vorhandener
Dateien oder ausreichende OAuth-Schreibrechte. Der vollständige
Kunden-/Uploadtest bleibt eine getrennte Abnahme. Ebenso beweist dieser Check
keine leere Galerie, da er keine Dateiliste abruft.

Nach dem Lauf die beiden Ordnerfelder in derselben Kundenzeile erneut
vergleichen. Bei einer Änderung den Check mit der aktuellen Zuordnung
wiederholen. Ein älterer Bericht darf keine spätere Aktivierung autorisieren.

## Fehler und Wiederholung

`INVALID_FOLDERS` verlangt zwei verschiedene syntaktisch gültige Ordner-IDs;
`INVALID_CONFIGURATION` bezeichnet fehlende oder ungültige private
Konfiguration. In beiden Fällen erfolgt kein Netzaufruf. `ACCOUNT_MISMATCH`
stoppt vor dem ersten Kundenordnerabruf.

`AUTH_REQUIRED`, `ACCESS_UNAVAILABLE`, `FOLDER_UNAVAILABLE`,
`UPLOAD_NOT_WRITABLE` und `PROCESSING_NOT_WRITABLE` erfordern die Prüfung
von Verbindung, Zuordnung beziehungsweise Rechten. Ein Eingangsordner,
den die kontrollierte SMA-Drive-Identität nur auflisten kann, besteht den
vorsichtigen Vorabcheck nicht mehr. Eine 404-Antwort beweist nicht, dass der Ordner
weltweit nicht existiert; der verwendete Zugang konnte ihn nicht lesen.
`RATE_LIMITED`, `READ_FAILED`, `UNEXPECTED_RESPONSE` und `TIMEOUT` liefern
keinen erfolgreichen Nachweis. Nach Klärung kann der Betreiber ausdrücklich
erneut prüfen. Es gibt weder automatische Wiederholungen noch einen
Fallback auf eine andere Verbindung.

Identität, beide HTTP-Abrufe und Antwortkörper teilen ein Zeitlimit von
zwölf Sekunden. Jeder Antwortkörper ist auf 16 KiB beschränkt. Weiterleitungen,
Teilantworten, falsche Typen, abgeschnittenes oder ungültiges JSON und
verspätete Antworten können keinen Erfolg erzeugen.

## Test und Bereitstellungsgrenze

```sh
node --test tests/onboarding-folder-preflight.test.cjs
```

25 isolierte Tests prüfen gültige und ungültige Metadaten, Kontoverwechslung,
fehlende Rechte, HTTP-Fehler, Geheimnisschutz, Größen- und Zeitgrenzen,
verspätete Antworten sowie den Abgleich mit dem bestehenden Katalog-Validator.
Sämtliche Google-Antworten sind simuliert; keine echten Ordner wurden damit
abgenommen. Die lokalen Tests benötigen keine zusätzlichen Pakete.

Das Werkzeug ändert weder den aktiven Zahlungsworkflow noch die Edge Function.
Die koordinierte produktive Ordnerkorrektur aus PR #346 bleibt eine eigene
Bereitstellung und wird durch diesen Check nicht ersetzt oder freigegeben.

## API-Grundlage

Google Drive API v3:
[files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get),
[Datei-Berechtigungen](https://developers.google.com/workspace/drive/api/reference/rest/v3/files),
[about.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get),
[User.permissionId](https://developers.google.com/workspace/drive/api/reference/rest/v3/User).
Die abgefragten Fähigkeiten sind ausdrücklich Eigenschaften des jeweiligen
Google-Nutzers und Ordners, keine Freigabeentscheidung von SMA.

## Korrektur vom 18.11.2026 – Eingangsordner darf nicht nur lesbar sein

Der frühere Vorabcheck akzeptierte einen Eingangsordner selbst bei
`canAddChildren=false`, solange `canListChildren=true` gemeldet wurde.
Das war für eine Abnahme der Schreibfähigkeit der verwendeten
SMA-Drive-Verbindung zu schwach. Die neue Abfrage fordert für
**beide Ordner** ausdrücklich beide Fähigkeiten an und verweigert
bei fehlender Schreibfähigkeit mit `UPLOAD_NOT_WRITABLE` bzw.
`PROCESSING_NOT_WRITABLE` einen erfolgreichen Vorabbericht.
Die Abfragezahl bleibt bei maximal drei reinen Metadaten-GETs.

Dieser Vorabcheck wird weiterhin nicht automatisch ausgelöst und
blockiert oder aktiviert **keine** echten Zahlungen; die gesonderte
Abnahme des Drive-Kundenwegs bleibt verpflichtend.
