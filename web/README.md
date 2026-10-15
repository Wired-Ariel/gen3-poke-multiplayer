# `web/` — gen3-poke-multiplayer nel browser (stato al 2026-10-11)

Obiettivo (richiesta di Lain): chi vuole provare **apre una pagina**, scrive
la stanza e fa TUTTO dal browser — multiboot compreso — senza scaricare
nulla. Quello che resta fisicamente fuori dalla portata di qualunque sito:
**il firmware sul Pico** (UF2 drag&drop, una volta) e, su Windows, **il
driver WinUSB** (Zadig, una volta). Tutto il resto ora vive nella pagina.

## Il sito dal 2026-10-11: nuovo disegno, Stanze, chat della stanza

Il riferimento visivo era un disegno unico (pannello, stanze, stanza, mappa,
come funziona); qui sotto com'e' diventato codice. Le sezioni piu' in basso
(«Cosa c'e' OGGI» in poi) restano la storia di prima e valgono ancora, con una
differenza: **il pannello e' `gioca.html`, `index.html` e' la pagina d'ingresso**.

### Le pagine e i file

| File | Cosa | Provato |
|---|---|---|
| `css/sito.css` | lo stile comune: intestazione bianca con la navigazione (Pannello · Stanze · Mappa live · Come funziona), schede, riquadro verde scuro con l'erba, bottoni, **tutta la chat**. Punti di rottura di sempre: 900 px una colonna, 640 px bersagli da 44 px e campi a 16 px | a 1280, 1024 e 375 px: nessuno sbordo orizzontale, ordine delle colonne giusto (chat in fondo), campi a 16 px |
| `css/font.css` + `fonts/*.woff2` | **Figtree** e **JetBrains Mono** locali (OFL 1.1, `fonts/LICENZA.txt`): niente Google Fonts, niente risorse esterne. Ripiego: Segoe UI / Consolas | `document.fonts.check` vero su pannello, stanza e mappa (anche dentro l'iframe); serviti anche da `pannello.py` (`/fonts/`) |
| `gioca.html` + `js/app.js` | il pannello nel disegno 1a: **stepper verticale** (verde ✓ fatto, arancio con alone adesso, grigio da fare — ogni passo resta un bottone), **riquadro grande** col passo di adesso e UN bottone arancio, stato GBA/canale, fisarmoniche (Impostazioni con «Avanzate», Registro, Attrezzi, Diagnostica: sono `<details>` veri), colonna destra con la stanza e la **chat**. Tutti gli `id` di prima | senza Pico: spettatore, chat, invito, impostazioni, fisarmoniche, riconnessione. **Col Pico NO** (la logica di device/multiboot/club non e' stata toccata) |
| `stanze.html` + `js/stanze.js` | **nuova**: numero + Entra + Crea stanza nuova, elenco delle **stanze aperte** vero (`GET /ws?stanze`, ogni 5 s, pallini dei posti, Entra/Piena/Guarda), ultima stanza, interruttore «Mostra la mia stanza nell'elenco», `?stanza=N` | con relay vero e due stanze aperte da giocatori finti: elenco, «la tua», conteggi; stanza nuova; a 375 px |
| `stanza.html` + `js/stanza.js` | **nuova**: giocatori (nome, luogo, cosa fa), spettatori, invito, **chat completa**, scheda **Mappa live** con la **chat piccola** sopra, «Adesso nella stanza», notifiche. Due modi, scelti da sola: OSPITE del pannello aperto in un'altra scheda, oppure SPETTATORE col suo collegamento (`T_WATCH`) | tutti e due i modi e il passaggio dall'uno all'altro nei due versi; mappa incorporata con i giocatori; chat piccola (Blocca, ⇄, –, pillola, stato salvato); «Mappa ↗» su una posizione |
| `progetto.html` | come funziona e crediti nel disegno 2c: indice a sinistra che segue la lettura, catena fatta di etichette, i 4 passi del multiboot in riquadri, crediti in griglia. Testo di prima; il Cable Club dal browser e' detto | a 1280 e 375 px |
| `index.html`, `index-en.html` | la pagina d'ingresso: solo font e colori nuovi, banner della versione, link a Stanze | caricata, non ridisegnata |
| `../net/mappa.html` | la Mappa live (LO STESSO file del pannello Python): intestazione e navigazione nuove, lato a sezioni, **chat in fondo al lato**, nomi dei giocatori e colori per giocatore sulle etichette, `?mappa=g.n&x=&y=` (apre su una posizione condivisa, con un anello che pulsa), `?dentro=1` (solo la mappa, per l'iframe della stanza) | sul sito: da sola (ospite di una scheda collegata) e dentro `stanza.html`. **Dentro il pannello Python: provate le rotte e i dati (`/fonts/`, `chat` in `api/posizioni`), NON guardata a schermo** |
| `js/sito.js` | le cose comuni: lingua, impostazioni salvate, nomi dei luoghi (`mappa/nomi.json`), elenco delle stanze, appunti, il «bip» delle notifiche (WebAudio, nessun file) | usato da tutte le pagine qui sopra |
| `js/chat.js` | **la chat, senza DOM**: corpo dei `T_CHAT` (gemello di `protocol.py`), `Store` (200 voci, dedup sull'id, ordine sul `ts` corretto con l'arrivo, sessionStorage per stanza), `Sessione` (nomi, «sta scrivendo», 5 messaggi in 10 s per chi scrive E per chi riceve, schede portanti e ospiti su BroadcastChannel) | `bridge_test.html`: 25 casi nuovi |
| `js/chat-ui.js` | il disegno: bolle raggruppate per persona, Rispondi con citazione, ◎ Posizione, eventi di gioco nella stessa linea del tempo, filtri, @menzione, frasi rapide, tre stili (piena / stretta / righe). Il testo della rete entra solo con `textContent` | a schermo, fra due browser veri |
| `../tools/gen_en.py` | **le pagine inglesi si GENERANO**: `gioca`, `stanze`, `stanza`, `progetto` tengono le due lingue nello stesso file (`.l-it`/`.l-en`, `data-en-*`) e la `-en.html` la scrive questo script. `--check` per la guardia | generate e aperte; `prepara-sito-web.ps1` si ferma se sono vecchie |
| `../tools/servi-sito.py` | il sito in locale senza assemblarlo: serve `web/`, `mappa.html` da `net/`, i dati della mappa da dove gli si dice | e' il server con cui e' stato provato tutto |

### La chat: come viaggia

- **`T_CHAT` = 10** (`net/protocol.py`, `js/relay.js`). Corpo JSON utf-8, al massimo 1200 byte, tre forme:
  messaggio `{"id","nome","testo","ts","rispondeA"?,"pos"?}` (testo ≤ 280 caratteri), `{"scrive":true,"nome"}`,
  e `{"ciao":1|0,"nome","ruolo"}`. **Il nome viaggia li' dentro** (in ogni messaggio e nel «ciao» ogni 10 s):
  non nell'annuncio di presenza, perche' il relay non inoltra gli HELLO e i 12 byte degli eventi sono del gioco.
  Il «ciao» e' anche l'unico modo in cui uno spettatore si fa vedere dagli altri.
- **`relay.py`** lo inoltra a tutta la stanza, **spettatori compresi**, e lo accetta **anche da uno spettatore**
  (gli `T_EVENT` da spettatore restano rifiutati). Non apre il corpo: controlla la lunghezza e un tetto di
  **10 datagrammi in 10 s per peer** — dieci e non cinque perche' nello stesso tipo passano «ciao» e «sta
  scrivendo». Il limite dei **5 messaggi in 10 s** lo applicano i client, chi scrive e chi riceve.
  Non tiene lo storico: chi entra legge da li' in poi.
- **`relay_ws.py`** non e' cambiato: porta il `T_CHAT` byte per byte come gli altri.
- **Nel browser**: dedup sull'`id`, ordine sul `ts` del mittente (se e' nel futuro o piu' vecchio di 15 s
  vale l'ora di arrivo), ultimi 200 in `sessionStorage` per stanza.
- **Fra le schede dello stesso browser** (BroadcastChannel `gen3pm-stanza`): la scheda col relay collegato e'
  PORTANTE, le altre sono OSPITI e scrivono attraverso di lei. Cosi' una persona non compare due volte.
- **Python**: `client.py` li riceve, li scrive nel registro (`[chat ] nome: testo`) e nel file delle
  posizioni; `pannello.html` e la Mappa del pannello li mostrano **in sola lettura**. Lo script di mGBA li ignora.
- **Eventi di gioco** nella stessa linea del tempo: generati in locale da cio' che il bridge sa gia'
  (`onAmico`: entra/esce; `onClub`: il Cable Club nostro o di un amico) e dal «ciao» (spettatore arriva/va).

### Scelte fatte, e perche'

- **La colonna «ultimo messaggio» dell'elenco delle stanze non c'e'.** Il relay dovrebbe aprire i messaggi
  (oggi non legge il contenuto di niente) e pubblicare a chiunque l'ultima frase di una stanza.
- **L'interruttore «Mostra la mia stanza» di `stanze.html` scrive l'impostazione, non il pacchetto.** Il
  `T_PUBLIC` lo accetta solo da un GIOCATORE dentro la stanza: lo manda (e lo rinnova ogni 5 s) il pannello
  mentre si gioca, che se e' aperto in un'altra scheda vede il cambio subito.
- **«Entra» non fa giocare.** Giocare vuol dire avere il Pico, e il Pico sta nella scheda del pannello. «Entra»
  scrive la stanza nelle impostazioni e apre la sua pagina (chat, chi c'e', mappa); «Guarda» apre la stessa
  pagina senza cambiare la stanza. Per comparire nel gioco: Pannello → Gioca.
- **Dal pannello le altre pagine si aprono in un'altra scheda** quando c'e' qualcosa di vivo (Pico collegato,
  partita): cambiare pagina ucciderebbe il collegamento USB.
- **Su telefono il riquadro col passo di adesso sta in cima**, sopra lo stepper: e' il bottone che serve.
- **DIFETTO TROVATO E CORRETTO: la riconnessione automatica al relay non partiva** (dal 27/09). In `relay.js`
  c'erano due `var T` nella stessa funzione (i timer di Battito e la tabella dei tipi): vinceva la seconda,
  `T.setTimeout` non esisteva e la `onclose` moriva subito dopo aver scritto «riprovo fra N s». Ora i timer
  si chiamano `Orologio`. Verificato spegnendo e riaccendendo `relay_ws.py`: le pagine rientrano da sole.
- `test_versione.py` era rosso da prima (aspettava una tupla senza le `caps` del 27/09): allineato.

### Come si prova (procedura CH)

Niente hardware. Tre finestre di terminale dalla radice del repository, poi il browser:

```
python net/relay.py --port 9000
python net/relay_ws.py --port 9001 --bind 127.0.0.1
python tools/servi-sito.py --port 7413 --mappa <cartella con dati.json>
```

1. **Test automatici.** `python net/test_chat.py` → `REGRESSIONE CHAT: PASSATA` (9 passi: inoltro,
   spettatore che legge e scrive, altra stanza muta, corpo troppo lungo, 16 in raffica → ne passano 10,
   dedup, relay_ws nei due versi). `bridge_test.html?relay=ws://127.0.0.1:9001` → **130 ok, 0 ko**
   (`test.html` 12/12 e `mb_test.html` TUTTO PASSATO come prima). `python tools/gen_en.py --check` → tutte aggiornate.
2. **Due persone.** Apri il sito da DUE origini diverse, cosi' i due browser non si parlano fra schede:
   `http://localhost:7413/gioca.html` e `http://127.0.0.1:7413/stanza.html?stanza=4242`. In ognuna: relay
   `ws://127.0.0.1:9001`, stanza 4242, un nome diverso. Nella prima premi «Guarda soltanto».
   **Criterio**: in ognuna l'altro compare fra gli spettatori col suo nome; un messaggio scritto in una
   arriva nell'altra col nome giusto; `@nome` colora la bolla e dice «ti ha menzionato»; «Rispondi» porta
   la citazione; il sesto messaggio in 10 s viene rifiutato con l'avviso.
3. **Ospite e portante.** Con il pannello che guarda la stanza, apri `stanza.html?stanza=4242` dalla STESSA
   origine. **Criterio**: l'intestazione dice lo stato del pannello, tu compari UNA volta sola fra gli
   spettatori, e un messaggio scritto li' esce col nome del pannello. Ferma il pannello: entro ~3 s la
   pagina della stanza si collega da sola (la pillola del relay torna verde).
4. **Riconnessione.** Chiudi `relay_ws.py`: la pillola diventa rossa e la chat si spegne con la spiegazione.
   Riaprilo: entro 10 s torna verde senza toccare niente.
5. **Mappa.** In `stanza.html` premi la scheda «Mappa live»: Hoenn, la chat piccola in basso a sinistra a
   mezza opacita'; Blocca la tiene piena, ⇄ la sposta, – la riduce a «Chat · N messaggi». Ricarica: resta com'era.
6. **Telefono** (strumenti del browser, 375 px): nessuno scorrimento orizzontale in nessuna pagina; nel
   pannello il riquadro verde e' in cima e la chat in fondo.

### Cosa NON e' verificato (2026-10-11)

- **Niente con il Pico e il GBA**: il pannello nuovo e' stato provato solo da spettatore. `device.js`,
  `multiboot.js` e `club.js` non sono stati toccati e `app.js` chiama le stesse funzioni di prima, ma i tre
  passi veri (collega, carica, gioca) e il Cable Club col disegno nuovo **vanno provati sul fisico**.
- **«◎ Posizione» con una posizione vera**: provato il rifiuto quando non c'e' («serve il gioco avviato»),
  e la scheda di una posizione ricevuta da un giocatore finto; non l'invio dal proprio GBA.
- **La chat con un giocatore vero dentro mGBA o col pannello Python** dall'altra parte: provati il formato
  (`test_chat.py`, corpo Python letto dal JS) e `client.py` da solo, non una partita mista.
- **`prepara-sito-web.ps1` per intero**: provato solo nella parte nuova (controllo delle -en, copia di
  pagine/css/font, guardia sui file mancanti), a secco. Il sito in linea (pubblicato il 2026-10-11 insieme
  al relay, e verificato da fuori: 130 ok su `bridge_test.html` contro il relay vero) e' stato caricato
  copiando i file a mano. Il relay va sempre aggiornato **insieme** al sito: con un `relay.py` vecchio i
  `T_CHAT` finiscono in «tipo sconosciuto» e la chat resta muta (il resto funziona).
- **Firefox e Safari**: la chat e la pagina della stanza non usano WebUSB e dovrebbero funzionare, ma sono
  state aperte solo in un browser Chromium.
- **La Mappa live dentro il pannello Python**, a schermo. E il Worker Cloudflare, come sempre (ha solo
  l'inoltro dei `T_CHAT`, senza il tetto di frequenza).
- **Lettori di schermo**: ruoli e nomi ci sono (`role="log"`, `aria-pressed`, `aria-current`), non provati.

## Cosa c'e' OGGI (la storia fino al 2026-09: il pannello era `index.html`)

| File | Cosa | Gemello Python | Provato |
|---|---|---|---|
| `index.html` + `js/app.js` | **il pannello gen3-poke-multiplayer** (stessa faccia di `net/pannello.html`): 0 Collega il Pico, 1 Carica il gioco nel GBA, 2 Gioca; schede stato (tuo GBA / amici / canale), impostazioni in localStorage, «Prova il relay», registro con le righe di `client.py` | `pannello.py` + `pannello.html` | nel browser (senza Pico): impostazioni, prova del relay (PONG 2 ms), errori giusti, immagini, niente overflow; **col Pico NO** |
| `js/device.js` | il Pico via WebUSB (apertura misurata, `transferIn` sempre pendente, F-4) | `usb_link.py` | **NO: mai collegato a un Pico** |
| `js/multiboot.js` | il multiboot MultiPlay 16 bit, riga per riga da `mb_multi.py` | `mb_multi.py` | `mb_test.html`: lo stesso autotest, tutto passato |
| `js/sio.js` | framing SYNC/HEAD/DATI/CKSUM, de-framer FSM, decodifica eventi e sonda | `usb_link.py`, `protocol.py` | `test.html` 12/12 |
| `js/relay.js` | header OWL1 (pack/unpack) + `RelayLink`: WebSocket verso il relay, riconnessione automatica | `protocol.py` | `bridge_test.html` |
| `js/bridge.js` | **il porting di `client.py`**: dedup/riordino sul seq, ricucitura in linea retta, copie x2 con secchiello, VIA dal T_BYE, RTT, righe di log identiche | `client.py` | `bridge_test.html`: 73 casi (ricucitura + header + dedup + VIA + spettatore + **club**) **+ 4 INTEGRATI** attraverso `relay_ws.py` + `relay.py` veri |
| `../net/relay_ws.py` | **il frontale WebSocket del relay**: ogni browser diventa una socket UDP verso `relay.py`; stanze, BYE, timeout restano la'. Browser ed emulatori/GBA+client.py nella STESSA stanza | — (stdlib) | `net/test_relay_ws.py`: 8 test, compreso browser↔UDP e il VIA alla chiusura |
| `relay-worker/` | il relay su Cloudflare Workers + Durable Objects (opzione "zero server", mondo browser-only) | `relay.py` | **NO: scritto, mai eseguito** (niente account in sessione) |
| `../tools/prepara-sito-web.ps1` | assembla `build/sito-web/` (pagina + js + img + `mbstub.gba` + `config.js` coi default), con la guardia anti-stub-vecchio | `prepara-pacchetto-amico.ps1` | eseguito: 15 file, 56 KB |

| `mappa.html` + `mappa/` | **la mappa live**: LO STESSO file del pannello Python, non una copia. Prende le posizioni da `api/posizioni` se c'e' un server dietro, e via **BroadcastChannel** dal pannello web se no. `prepara-sito-web.ps1` ci mette anche i ~11 MB di dati generati da `gen_mappa.py` | `pannello.py` (`/mappa.html`, `/api/posizioni`) | provata in locale E in produzione: 518 mappe, 160 porte, 49/49 immagini, 2 giocatori finti disegnati con nomi e stati giusti |

**Il Cable Club c'e' anche dal browser (2026-08-26).** `js/club.js` e' il
porting riga per riga di `club_link.py` (epoche, sequenze, riannunci, giri del
link, watchdog: la stessa macchina a stati, stesso protocollo T_CLUB byte per
byte — verificato contro `protocol.py` in tutte e due le direzioni);
l'orchestrazione sta in `bridge.js` (specchio della parte club di `client.py`:
quarantena, versioni, pompa) e il trasporto in `device.js`
(`clubEnter`/`clubExit`: il Pico in modo LINK via WebUSB, con la transferIn
sempre pendente per endpoint — il motivo per cui il doppio thread di
`usb_link.py` qui non serve). Differenza sostanziale, I RUOLI: peer 1 =
master e peer 2 = slave come in Python, ma fra due peer sorteggiati vince il
piu' basso, e il peer dell'amico si legge dall'header del primo T_CLUB (il
comando di ruolo al device aspetta quel pacchetto). Il pannello Python
riconosce il client web dall'impronta riservata `IMPRONTA_WEB`
(`protocol.py`) e dice «l'amico gioca dal browser» invece di urlare al
pacchetto vecchio. Test: `bridge_test.html` 73/73 (i 25 casi di
`net/test_club.py` portati + ruoli sorteggiati + orchestrazione), piu' la
sessione end-to-end browser↔browser sopra `relay_ws.py`+`relay.py` veri e la
MISTA browser↔`finto_club.py` (il vero `ClubSession` Python): scala completa,
7 comandi Gen-3 in ordine, dedup dei rilanci. **NON ancora provato col Pico e
i GBA veri.** Durante uno scambio la scheda va tenuta in PRIMO PIANO: in
background il browser strozza i timer (rilanci e riannunci), anche se il
percorso dati e' a eventi e sopravvive. Manca ancora: il simulatore di rete.

Aggiunte del 2026-08-25 (riscontri di Lain dopo la prova in produzione):
`progetto.html` (come funziona il progetto + crediti completi, linkata dal
footer), guide sotto OGNI campo delle impostazioni, errori WebUSB tradotti con
il rimedio (chooser vuoto/Zadig/interfaccia occupata), registro con **buffer
completo** e bottone «Scarica il log completo», e le **posizioni per la Mappa
live pubblicate a ogni evento di rete** (bridge `onPos`) invece che dal
`setInterval` — che in una scheda in background il browser rallenta fino a un
tick al minuto ed era il «movimento che si blocca» visto sul sito.

## Partita MISTA (GBA + emulatori + browser)

Funziona gia', non serve niente di nuovo: **stesso relay, stessa stanza,
numeri di peer tutti diversi**. In pratica:

- **browser + Pico + GBA** → questa pagina (peer sorteggiato a caso, va bene);
- **pannello Python + Pico + GBA** → relay `host:9000` (UDP), stessa stanza; in
  tre o piu' compilare il campo **peer** nelle impostazioni (0 = automatico
  ospite→1/amico→2, che in tre collide);
- **emulatore mGBA** → `client.py --transport tcp` + Lua (pacchetto emulatore),
  `--room` uguale e `--peer-id` diverso.

L'unico vincolo di infrastruttura: il server deve esporre SIA la porta UDP di
`relay.py` (per Python/mGBA) SIA il `wss://` di `relay_ws.py` (per i browser).
La macchina Oracle li ha entrambi. Il Worker Cloudflare invece e' browser-only.

## Firefox e Safari: perche' NO, e cosa si puo' fare lo stesso

**WebUSB non esiste su Firefox e non esistera'**: Mozilla l'ha marcata
**"harmful"** nella sua standards position (fingerprinting, esposizione
dell'hardware USB, modello di consenso debole). Non c'e' un flag in
`about:config`. Safari idem: WebKit e' dichiaratamente contrario.

**E WebSerial?** Firefox 151 (maggio 2026) l'ha aggiunta davvero — ma **non
ci serve**, e la ragione e' l'hardware, non il browser: il Pico si presenta
come device **vendor-class con quattro endpoint** (comandi 0x01, stato 0x81,
dati 0x02/0x82, vedi `usb_link.py`). WebSerial da' UNA sola pipe seriale
bidirezionale, e non puo' reclamare un'interfaccia vendor. Per passare di
li' bisognerebbe **rifare il protocollo del firmware RP2040** su CDC, su
entrambi i lati. E' un progetto, non un adattamento.

**Cosa funziona su Firefox: la modalita' SPETTATORE.** Il bottone «Guarda
soltanto» avvia il bridge con `device = null`: ci si collega al relay, si
ricevono le posizioni degli amici e si guardano sulla Mappa live. Non si
manda niente (non c'e' un GBA da leggere), ma non e' poco - serve anche a
chi il GBA ce l'ha in un'altra stanza. L'avviso in cima alla pagina lo
spiega, cosi' chi arriva con Firefox non pensa che il sito sia rotto.

## Come funziona

```
browser A (WebUSB -> Pico -> GBA)  --wss-->  relay_ws.py  --UDP-->  relay.py  <--UDP--  client.py (mGBA / GBA) 
browser B (WebUSB -> Pico -> GBA)  --wss-->  relay_ws.py  --UDP-->    "
```

Il messaggio WebSocket (binario) e' il datagramma OWL1 di `protocol.py`,
byte per byte: il frontale non interpreta niente. L'unica cosa che inventa
e' un `T_BYE` a nome del peer quando la sua socket si chiude, cosi' l'amico
vede il VIA entro un secondo invece che al timeout. La stanza viaggia anche
nell'URL (`/ws?stanza=N`): a `relay_ws.py` non serve, al Worker si'.

## Dove ospitare: la raccomandazione

Tre requisiti fissi: (1) la pagina su **https** (WebUSB lo pretende; vale
anche `http://localhost`), (2) il relay raggiungibile in **wss://** (una
pagina https non puo' aprire `ws://`), (3) firmware + Zadig restano
comunque. Tre strade, in ordine di quando usarle:

1. **Per provare SUBITO, gratis, senza aprire porte: Cloudflare Tunnel sul PC
   di Lain.** `cloudflared` (un eseguibile) pubblica un servizio locale su un
   URL https/wss di `trycloudflare.com`, WebSocket compresi, senza account:

   ```
   cloudflared tunnel --url http://127.0.0.1:7413     # la pagina (python -m http.server nella cartella del sito)
   cloudflared tunnel --url http://127.0.0.1:9001     # relay_ws.py (con relay.py acceso accanto)
   ```

   Ognuno stampa un URL `https://<parole-a-caso>.trycloudflare.com`. Il primo
   lo apre l'amico nel browser; il secondo, come `wss://<parole>.trycloudflare.com/ws`,
   va nel campo Relay (o in `config.js` via `prepara-sito-web.ps1 -Relay ...`).
   Gli URL cambiano a ogni avvio: va bene per le prove, non per «dare un
   indirizzo agli amici».
2. **Per il definitivo: un VPS piccolo (4-5 euro/mese) con Caddy** — e' la
   strada consigliata, perche' tiene **un mondo solo**: browser, mGBA e GBA
   con `client.py` nella stessa stanza (il Worker no). Caddy fa https e il
   certificato da solo; serve un nome DNS (anche gratuito). Ricetta in
   `net/RELAY-VPS.md`, sezione «Con il pannello web».
3. **Zero server: Cloudflare Pages + Workers** (`relay-worker/`). Gratis,
   wss incluso, niente da mantenere, edge vicino. Svantaggi: mondo
   browser-only, account Cloudflare + `wrangler` (npm), e **non l'ho mai
   eseguito**: la prima prova e' `wrangler dev` + `bridge_test.html?relay=ws://127.0.0.1:8787/ws`.

Chi pubblica la pagina da' agli amici **un URL e una stanza**. Fine.

## Come si prova (procedura W-web)

Tutto in ordine; ogni punto ha il suo criterio. I punti 1-2 non toccano
l'hardware e sono gia' stati eseguiti (2026-08-23, nel browser della
sessione).

1. **Autotest** (nessun hardware): `test.html` → 12/12; `mb_test.html` → TUTTO
   PASSATO; `bridge_test.html` → 28 ok. Con `relay.py` e `relay_ws.py` accesi,
   `bridge_test.html?relay=ws://127.0.0.1:9001` → **32 ok** (i 4 INTEGRATI:
   A→B ricucito e con le copie, B→A, PONG, VIA alla chiusura).
2. **Pannello in locale**, senza Pico:
   ```
   cd overworld-link
   D:\Progettini\Python313\python.exe net\relay.py --port 9000
   D:\Progettini\Python313\python.exe net\relay_ws.py --port 9001 --bind 127.0.0.1
   D:\Progettini\Python313\python.exe -m http.server 7413 --bind 127.0.0.1
   ```
   Chrome/Edge su `http://127.0.0.1:7413/web/`. Relay `ws://127.0.0.1:9001`,
   stanza a piacere, Salva, **Prova il relay** → «relay raggiungibile: PONG in
   N ms». Gioca senza Pico → «prima collega il Pico (passo 0)».
3. **Col Pico e il GBA** (Lain, ~10 minuti). Il pannello Python NON deve
   essere collegato al Pico nello stesso momento.
   - **Collega il Pico**: finestra del browser, scegli 2FE3:000A → targa
     «Pico: ...» verde, nel registro `Cancel`, `SetMode`, `master`, `StartHandshake`.
     Se fallisce qui e `0-prova-canale.bat` funziona, il sospetto e' `device.js`
     (riarmo delle letture): incollare il registro.
   - **Carica il gioco nel GBA** (slot vuoto, acceso dopo il cavo): registro
     `client 1 rilevato`, `handshake ok`, `trasferimento N%`, `DONE! CRC`,
     schermo ROSSO; poi `Pico riavviato (F-4)` e `canale riaperto dopo il
     multiboot` da solo (se no: Collega il Pico). Tempi: ~14 s a 3700,
     ~26 s a 7400.
   - cartuccia dentro (rosso → giallo → verde → gioco); in overworld la
     diagnostica mostra `sonda #1` entro ~2 s e la scheda «Il tuo GBA» passa
     a «Programma caricato».
   - **Gioca**: relay e stanza impostati, LED relay verde, RTT nella scheda
     canale; camminando 30 s **Inviati ≥ 15**, «mappa g.n (x,y)» nella scheda.
     Con un amico (altro browser, o il pannello Python con `client.py`)
     nella stessa stanza: «1 collegato» con la sua mappa, **Ricevuti** che
     sale, e in gioco ci si vede come sempre. Chiudendo la scheda
     dell'amico, il suo avatar sparisce entro ~2 s (VIA).
4. **Pubblico** (tunnel o VPS): stesso punto 3 con l'URL https della pagina e
   il relay wss://. La prova del relay deve dare un RTT coerente con il ping
   verso il server (+ qualche ms).

**Cosa NON e' verificato** (2026-08-23): tutto il punto 3 e 4 (nessun Pico
collegato a un browser, mai); il Worker Cloudflare; `relay_ws.py` dietro
Caddy/tunnel (provato solo in locale e nei test). La logica sotto (sio,
multiboot, bridge, frontale) e' provata dagli autotest e dai test Python.
