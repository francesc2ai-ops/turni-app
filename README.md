# I miei turni

App per smartphone e PC che mostra il calendario dei **tuoi** turni partendo dal foglio turni del reparto.

- Accesso con il nome nel formato `Nome.Cognome`
- Il foglio si carica come **file Excel**, **PDF** (anche scansionato) o **foto** (scattata al momento o dalla galleria)
- Schermata di controllo per correggere i turni prima di salvarli
- Calendario del mese con oggi e domani in evidenza
- **Aggiungi al calendario del telefono**: crea gli eventi con due promemoria, la sera prima ("Domani: Mattina 07:00–14:00") e poco prima dell'inizio
- Sigle e orari dei turni personalizzabili nelle impostazioni

## Privacy

Questo repository contiene **solo il codice** dell'app, nessun turno e nessun nome.
I file caricati vengono letti **sul dispositivo** e i turni restano salvati solo lì.
Non viene inviato nulla a server esterni: da internet si scaricano solo i componenti per leggere Excel, PDF e foto (SheetJS, pdf.js, Tesseract).

## Come si installa

Apri il link dell'app:

- **iPhone (Safari)**: tasto Condividi → *Aggiungi alla schermata Home*
- **Android (Chrome)**: menu ⋮ → *Installa app* / *Aggiungi a schermata Home*
- **PC (Chrome o Edge)**: icona di installazione nella barra degli indirizzi

## Notifiche

Il modo più affidabile, su tutti i telefoni, è **Aggiungi al calendario del telefono**: i promemoria arrivano dal calendario anche ad app chiusa.
Ripetilo ogni volta che carichi un nuovo mese.

L'app mostra anche una notifica con il turno di oggi e di domani quando la apri (dopo aver toccato *Attiva le notifiche*).

## Struttura

| File | Cosa fa |
|---|---|
| `index.html`, `styles.css` | Le schermate |
| `app.js` | Accesso, calendario, controllo, impostazioni, calendario del telefono |
| `parser.js` | Trova la tabella dei turni, i giorni e la riga della persona |
| `lettura.js` | Legge Excel, PDF e foto (pulizia dell'immagine e lettura del testo) |
| `sw.js`, `manifest.webmanifest` | Installazione come app e funzionamento offline |
