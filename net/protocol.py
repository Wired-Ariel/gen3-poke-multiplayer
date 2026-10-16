"""
protocol.py - il formato dei datagrammi fra client PC e relay.

Il relay NON guarda dentro l'evento di gioco: gli servono solo l'intestazione e
la stanza. E' la stessa disciplina di Celio-Server ("the server does not
interpret gameplay data"), e serve a poter cambiare il protocollo di gioco senza
ridistribuire il relay.

L'unico pezzo che conosce il formato dei 12 byte e' il client
(vedi extract_map_key sotto): in Fase 5 fara' lo stesso con i byte che arrivano
dall'USB invece che da mGBA.
"""

import struct

MAGIC = b"OWL1"          # OverWorld Link, versione 1
HEADER_FMT = "<4sBBHHB"  # magic, versione, tipo, peerId, roomId, seq
HEADER_SIZE = struct.calcsize(HEADER_FMT)
VERSION = 1

# Dimensione di struct NetEvent nel payload (payload/main.c).
EVENT_SIZE = 12

# Tipi di datagramma. Nulla a che vedere con i tipi di evento del gioco
# (PASSO/SYNC/GIRA), che vivono dentro il payload dei 12 byte.
T_HELLO = 0   # il client si presenta
T_EVENT = 1   # 12 byte di gioco, opachi per il relay
T_PING = 2    # sonda di latenza, il relay la rimanda indietro
T_PONG = 3
T_BYE = 4     # un peer se n'e' andato (dal relay ai compagni di stanza)
T_WATCH = 5   # "voglio GUARDARE questa stanza" (2026-08-26). Come l'HELLO
              # mette il peer in stanza, ma da SPETTATORE: riceve i broadcast,
              # NON conta nel tetto dei 4 giocatori, i suoi eventi non vengono
              # inoltrati e la sua uscita non produce un T_BYE per gli altri.
              # Serve a chi gioca in emulatore e vuole aprire il sito per
              # vedere la mappa live senza rubare un posto alla partita.
              #   Il 5 e' l'unico valore libero fra BYE (4) e CLUB (6).
              #   NON confonderlo con EV_STATUS = 5 piu' sotto: sono due
              #   spazi di nomi diversi - qui i TIPI DI DATAGRAMMA fra client
              #   e relay, li' i TIPI DI EVENTO dentro i 12 byte di gioco,
              #   che il relay non guarda nemmeno.
T_CLUB = 6    # sessione Cable Club (Consegna D): il relay lo inoltra ai
              # compagni di stanza ESATTAMENTE come un T_EVENT, senza guardare
              # dentro. Il corpo e' affare dei client (vedi club_pack sotto).
T_PUBLIC = 7  # "la mia stanza e' APERTA" (2026-09-27): corpo [1 byte, 1 = si',
              # 0 = no]. Lo manda un GIOCATORE della stanza, e va rinnovato:
              # il relay lo dimentica dopo PUBBLICA_S secondi (relay.py), cosi'
              # un riavvio del relay o una scheda chiusa non lasciano stanze
              # fantasma nella lista. Opt-in: nessuna stanza e' pubblica da sola.
T_LIST = 8    # l'elenco delle stanze aperte. Richiesta SOLO da loopback (e'
              # relay_ws.py che la fa, per servirla su GET /ws?stanze); la
              # risposta porta nel corpo un JSON utf-8.

T_TAKEN = 9   # "il tuo peer-id e' GIA' IN USO in questa stanza" (2026-09-27).
              # Dal relay al client che arriva con un numero che un ALTRO
              # client (giocatore o spettatore) sta usando ed e' vivo (ha
              # parlato negli ultimi VIVO_S secondi, relay.py). Il nuovo resta
              # fuori dalla stanza, chi c'era non viene toccato. Corpo: 1 byte,
              # 0 = lo usa un giocatore, 1 = uno spettatore. Il relay lo manda
              # al massimo una volta al secondo per peer.

T_CHAT = 10   # LA CHAT DELLA STANZA (2026-10-11). Il relay lo inoltra a TUTTA la
              # stanza, SPETTATORI COMPRESI, e anche uno spettatore lo puo'
              # mandare: e' l'eccezione voluta a "uno spettatore non parla"
              # (T_EVENT e T_CLUB da spettatore restano rifiutati). Il corpo e'
              # JSON utf-8 e il relay NON lo legge: guarda solo quanto e' lungo
              # (CHAT_CORPO_MAX) e quanti ne arrivano (relay.py, CHAT_MAX in
              # CHAT_FINESTRA_S secondi per peer). Tre forme, vedi chat_unpack:
              #   messaggio  {"id","nome","testo","ts","rispondeA"?,"pos"?}
              #   scrive     {"scrive":true,"nome"}        «sta scrivendo...»
              #   ciao       {"ciao":1|0,"nome","ruolo"}   nome e ruolo di chi
              #              c'e' (1) o se ne va (0): e' cosi' che il nome
              #              viaggia, e che uno spettatore si fa vedere.
              # Il relay non tiene lo storico: chi entra legge da li' in poi.

TYPE_NAMES = {
    T_HELLO: "HELLO",
    T_EVENT: "EVENT",
    T_PING: "PING",
    T_PONG: "PONG",
    T_BYE: "BYE",
    T_WATCH: "WATCH",
    T_CLUB: "CLUB",
    T_PUBLIC: "PUBLIC",
    T_LIST: "LIST",
    T_TAKEN: "TAKEN",
    T_CHAT: "CHAT",
}

# --- corpo dei T_CLUB --------------------------------------------------------
# Il protocollo del Cable Club via relay. E' la porta in Python della sessione
# Celio (repo-studio/Celio-Server/src/session.ts, GPL-3.0, letta il
# 2026-08-09): stessi statusi e comandi del device, ma la negoziazione dei
# ruoli e' collassata (peer 1 = master, peer 2 = slave, sempre) e il relay
# resta stupido: la logica di sessione vive nei due client.
#
#   OGNI corpo porta, subito dopo il sub, l'EPOCA (u32 LE): l'identita' della
#   ClubSession che l'ha generato, sorteggiata alla nascita della sessione.
#   E' la cura del difetto visto sul campo il 2026-08-19: un client riavviato
#   ricominciava le sequenze da 0 mentre il partner continuava dalle sue, e i
#   blocchi finivano TUTTI in "fuori-ordine"/"dup" (log reale: `fuori-ordine
#   46 richiesti 736`) - il device non riceveva piu' niente e la sessione
#   restava zombie. Con l'epoca il partner si accorge del riavvio e riaggancia.
#
#   CLUB_STATUS: [sub u8][epoca u32][sseq u16][status u16]  stato del MIO device.
#                sseq numera gli stati per il dedup: su UDP ogni stato parte
#                in 3 copie (perderne uno appende la sessione: un
#                LinkConnected perso = il partner non manda mai ConnectLink)
#   CLUB_DATA:   [sub u8][epoca u32][seq u32][64 byte]      un blocco (32 parole)
#   CLUB_REQ:    [sub u8][epoca u32][n u8][seq u32 * n]     "rimandami questi"
#   CLUB_ENTER:  [sub u8][epoca u32]                        "il mio GBA e' al club"
#   CLUB_LEAVE:  [sub u8][epoca u32]                        "sessione club finita"
# LA VERSIONE DEL CLUB. Si alza a mano quando cambia la macchina a stati
# del club (non per una correzione qualsiasi): due client con numeri diversi
# NON possono portare a termine una sessione, e devono dirselo subito.
#   1 = prima versione (Consegna D)    2 = epoche (2026-08-19)
#   3 = riapertura del link a ogni meccanica (2026-08-20)
#   4 = fine sessione su riapertura mai completata + watchdog che non conta
#       i riannunci (2026-08-27: il frullatore e l'annullo chiudono il link
#       senza EXIT_ROOM, e il club restava appeso fino al riavvio)
VERSIONE_CLUB = 4


def _impronta_sorgenti():
    """32 bit ricavati dai file che contano. Serve a distinguere due
    pacchetti diversi con la STESSA versione: un amico che non ha copiato
    l'ultimo zip ha lo stesso numero ma un'impronta diversa, e il log lo
    dice invece di lasciar morire la sessione in silenzio."""
    import hashlib
    import os
    qui = os.path.dirname(os.path.abspath(__file__))
    h = hashlib.md5()
    for nome in ("protocol.py", "club_link.py", "client.py", "usb_link.py"):
        try:
            with open(os.path.join(qui, nome), "rb") as f:
                # niente fine-riga nel conto: uno zip che passa da CRLF a LF
                # non e' una versione diversa
                h.update(f.read().replace(b"\r\n", b"\n"))
        except OSError:
            h.update(b"?")
    return int(h.hexdigest()[:8], 16)


IMPRONTA_SORGENTI = _impronta_sorgenti()

# L'impronta del CLIENT WEB (web/js/club.js, 2026-08-26): il sito non ha i
# .py da hashare, quindi nei suoi CLUB_STATUS manda questa costante riservata
# al posto dell'md5. controlla_versione (client.py) la riconosce e dice
# "l'amico gioca dal browser" invece di urlare al pacchetto vecchio.
# Stessa costante in club.js: si toccano insieme.
IMPRONTA_WEB = 0x57454221

# L'impronta dell'EMULATORE (mgba/club_lua.lua, 2026-08-27): come il sito, il
# Lua di mGBA non ha i .py da hashare. Serve a non far urlare "FILE DIVERSI" a
# chi gioca col GBA vero mentre l'amico e' in emulatore - che e' il caso
# normale, non l'eccezione: si toccano insieme, qui e in club_lua.lua.
IMPRONTA_LUA = 0x4C554131      # "LUA1"

CLUB_STATUS = 1
CLUB_DATA = 2
CLUB_REQ = 3
CLUB_ENTER = 4
CLUB_LEAVE = 5

# IL MODO SEGUACE (2026-09-27): le CAPACITA' in coda allo stato, dopo versione
# e impronta (un client vecchio le ignora come quelle). Stessi valori in
# web/js/club.js e mgba/club_lua.lua: si toccano insieme.
#   CAPS_SEGUO  - lo script di mGBA sa riprodurre le coppie del Pico;
#   CAPS_COPPIE - il MIO Pico le riferisce (firmware 2.0.6, comando 0x44);
#   CAPS_DECISO - la decisione e' presa: senza, l'altro aspetta.
CAPS_SEGUO = 0x0001
CAPS_COPPIE = 0x0002
CAPS_DECISO = 0x8000
CMD_COPPIE = 0x44          # comando HARDWARE del firmware F-5: [0x44][0|1]
PAIR_MARKER = 0xC0B1       # parola 16 del blocco riferito dal Pico


def club_status(epoca, sseq, status, versione=None, impronta=None, caps=None):
    """Lo stato del device, con in CODA versione e impronta di chi lo manda.

    In coda e non in testa apposta: un client vecchio legge i primi 9 byte
    come sempre e ignora il resto, quindi il controllo di versione non
    rompe la compatibilita' - e chi e' vecchio si riconosce proprio perche'
    quella coda non ce l'ha."""
    if versione is None:
        versione = VERSIONE_CLUB
    if impronta is None:
        impronta = IMPRONTA_SORGENTI
    corpo = struct.pack("<BIHHHI", CLUB_STATUS, epoca & 0xFFFFFFFF,
                        sseq & 0xFFFF, status & 0xFFFF,
                        versione & 0xFFFF, impronta & 0xFFFFFFFF)
    if caps is not None:
        corpo += struct.pack("<H", caps & 0xFFFF)
    return corpo


def club_data(epoca, seq, block64):
    return struct.pack("<BII", CLUB_DATA, epoca & 0xFFFFFFFF,
                       seq & 0xFFFFFFFF) + block64


def club_req(epoca, seqs):
    out = struct.pack("<BIB", CLUB_REQ, epoca & 0xFFFFFFFF, len(seqs))
    for s in seqs:
        out += struct.pack("<I", s & 0xFFFFFFFF)
    return out


def club_enter(epoca):
    return struct.pack("<BI", CLUB_ENTER, epoca & 0xFFFFFFFF)


def club_leave(epoca):
    return struct.pack("<BI", CLUB_LEAVE, epoca & 0xFFFFFFFF)


# I comandi del protocollo di link della Gen 3 (pokeemerald include/link.h):
# la parola 0 di ogni pacchetto da 8 parole e' il comando. Servono al log
# decodificato dei blocchi del club (client.py) e al partner finto
# (finto_club.py): la casa comune e' qui.
LINKCMD_NOMI = {
    0x0000: "(vuoto)",
    0x1111: "BLENDER_STOP",
    0x2222: "SEND_LINK_TYPE",     # il master apre lo scambio dati giocatore
    0xBBBB: "INIT_BLOCK",         # inizio di un block send (size, id)
    0x8888: "CONT_BLOCK",         # 14 byte di blocco per comando
    0xCCCC: "SEND_BLOCK_REQ",     # il master chiede un blocco a tutti
    0xCAFE: "SEND_HELD_KEYS",     # tasti tenuti (stanza link); 0017 = porta
    0x4444: "BLENDER_SEND_KEYS",  # tasti del frullatore, uno per frame
    0x5FFF: "READY_CLOSE_LINK",
    0x2FFE: "READY_EXIT_STANDBY",
    0x2FFF: "SEND_PACKET",
    0x5555: "DUMMY_1",
    0x5566: "DUMMY_2",
    0x6666: "SEND_EMPTY",
    0x7777: "SEND_0xEE",
    0x7FFF: "COUNTDOWN",
    0xAAAA: "BLENDER_NO_PBLOCK_SPACE",
    0xAAAB: "SEND_ITEM",
    0xAABB: "READY_TO_TRADE",
    0xABCD: "READY_FINISH_TRADE",
    0xBBCC: "READY_CANCEL_TRADE",
    0xCCDD: "START_TRADE",
    0xDCBA: "CONFIRM_FINISH_TRADE",
    0xDDDD: "SET_MONS_TO_TRADE",
    0xDDEE: "PLAYER_CANCEL_TRADE",
    0xEEAA: "REQUEST_CANCEL",
    0xEEBB: "BOTH_CANCEL_TRADE",
    0xEECC: "PARTNER_CANCEL_TRADE",
    0xEFFF: "LINKCMD_NONE",
}

# La MECCANICA della sessione: la parola 1 di SEND_LINK_TYPE e' gLinkType
# (pokeemerald include/link.h, LINKTYPE_*). Stamparla nel log risparmia una
# serata di decomp: il 2026-08-27 servi' proprio a scoprire che la sessione
# incriminata era un frullatore, non uno scambio.
LINKTYPE_NOMI = {
    0x1111: "scambio, alla macchina",
    0x1122: "scambio, aggancio",
    0x1133: "scambio, al bancone",
    0x1144: "scambio, staccato",
    0x2211: "lotta",
    0x2233: "lotta singola",
    0x2244: "lotta doppia",
    0x2255: "lotta multi",
    0x2266: "torre lotta L50",
    0x2277: "torre lotta libera",
    0x2288: "torre lotta",
    0x3311: "mix record, prima",
    0x3322: "mix record, dopo",
    0x4411: "frullatore, al bancone",
    0x4422: "frullatore, in corso",
    0x5501: "mystery event",
    0x5502: "e-reader RF/VF",
    0x5503: "e-reader smeraldo",
    0x6601: "gara, modo G",
    0x6602: "gara, modo E",
}


def club_block_riga(block64):
    """Le prime 8 parole di un blocco del club (il firmware ci mette UN
    pacchetto di comando, il resto e' zero) piu' il nome del comando."""
    w = struct.unpack("<8H", block64[:16])
    nome = LINKCMD_NOMI.get(w[0], "0x%04X?" % w[0])
    if w[0] == 0x2222 and w[1] in LINKTYPE_NOMI:
        nome += " = " + LINKTYPE_NOMI[w[1]]
    return "%s | %s" % (" ".join("%04X" % x for x in w), nome)


def club_unpack(body):
    """Ritorna (sub, epoca, payload) oppure None se malformato.

    Un client con i .py VECCHI produce corpi senza epoca: qui escono None e
    chi chiama li conta e lo dice nel log (versioni diverse = niente club)."""
    if len(body) < 5:
        return None
    sub = body[0]
    epoca = struct.unpack_from("<I", body, 1)[0]
    if sub == CLUB_STATUS and len(body) >= 9:
        sseq, status = struct.unpack_from("<HH", body, 5)
        if len(body) >= 15:
            versione, impronta = struct.unpack_from("<HI", body, 9)
        else:
            versione, impronta = 0, 0      # client di una versione vecchia
        caps = struct.unpack_from("<H", body, 15)[0] if len(body) >= 17 else 0
        return sub, epoca, (sseq, status, versione, impronta, caps)
    if sub == CLUB_DATA and len(body) >= 9 + 64:
        seq = struct.unpack_from("<I", body, 5)[0]
        return sub, epoca, (seq, body[9:9 + 64])
    if sub == CLUB_REQ and len(body) >= 6:
        n = body[5]
        if len(body) >= 6 + 4 * n:
            return sub, epoca, [struct.unpack_from("<I", body, 6 + 4 * i)[0]
                                for i in range(n)]
    if sub in (CLUB_ENTER, CLUB_LEAVE) and len(body) >= 5:
        return sub, epoca, None
    return None


# --- corpo dei T_CHAT ---------------------------------------------------------
# Gemello di web/js/chat.js (OwlChat.pack / OwlChat.unpack): si toccano insieme.
CHAT_TESTO_MAX = 280     # caratteri del testo
CHAT_NOME_MAX = 16       # caratteri del nome
CHAT_CITA_MAX = 80       # caratteri della citazione dentro una risposta
CHAT_ID_MAX = 24         # caratteri dell'id (lo sorteggia chi scrive)
# Il datagramma deve stare COMODO nell'MTU (1500 - 28 di IP/UDP - 11 di OWL1):
# 280 caratteri latini sono ~300-560 byte, e solo un messaggio di sole emoji
# arriva al tetto - li' chat_pack accorcia il testo finche' ci sta.
CHAT_CORPO_MAX = 1200
# Le EMOTE (2026-10-16): un messaggio con "emote" 0/1/2 e il simbolo come
# testo. L'ordine e' il contratto con EVENT_EMOTE del payload (dir 0 "!",
# 1 "?", 2 cuore), con web/js/chat.js (OwlChat.EMOTE) e col Lua.
CHAT_EMOTE = ["\u2757", "\u2753", "\u2764\ufe0f"]


def _chat_pulisci(testo, massimo):
    """Una riga di testo: niente caratteri di controllo, niente a capo, tagliata."""
    if not isinstance(testo, str):
        return ""
    pulito = "".join(" " if (ord(c) < 32 or ord(c) == 127) else c for c in testo)
    return pulito.strip()[:massimo]


def _chat_intero(v, lo, hi):
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def chat_normalizza(d):
    """Da un dizionario qualunque a una delle tre forme, oppure None.

    Ritorna un dizionario NUOVO con la chiave "tipo" ("msg", "scrive", "ciao")
    e solo i campi previsti, gia' puliti e tagliati: chi lo usa non deve
    fidarsi di niente di cio' che arriva dalla rete."""
    if not isinstance(d, dict):
        return None
    nome = _chat_pulisci(d.get("nome", ""), CHAT_NOME_MAX)
    if d.get("scrive") is True:
        return {"tipo": "scrive", "nome": nome}
    if "ciao" in d:
        return {"tipo": "ciao", "nome": nome, "ciao": 1 if d.get("ciao") else 0,
                "ruolo": "s" if d.get("ruolo") == "s" else "g"}
    ident = _chat_pulisci(d.get("id", ""), CHAT_ID_MAX)
    testo = _chat_pulisci(d.get("testo", ""), CHAT_TESTO_MAX)
    ts = d.get("ts")
    if not ident or not isinstance(ts, (int, float)) or isinstance(ts, bool):
        return None
    out = {"tipo": "msg", "id": ident, "nome": nome, "testo": testo, "ts": int(ts)}
    if _chat_intero(d.get("emote"), 0, len(CHAT_EMOTE) - 1):
        out["emote"] = d["emote"]
        if not testo:
            out["testo"] = testo = CHAT_EMOTE[d["emote"]]
    pos = d.get("pos")
    if isinstance(pos, dict) and _chat_intero(pos.get("g"), 0, 255) \
            and _chat_intero(pos.get("n"), 0, 255) \
            and _chat_intero(pos.get("x"), -32768, 32767) \
            and _chat_intero(pos.get("y"), -32768, 32767):
        out["pos"] = {"g": pos["g"], "n": pos["n"], "x": pos["x"], "y": pos["y"]}
    ris = d.get("rispondeA")
    if isinstance(ris, dict):
        rid = _chat_pulisci(ris.get("id", ""), CHAT_ID_MAX)
        if rid:
            out["rispondeA"] = {"id": rid,
                                "nome": _chat_pulisci(ris.get("nome", ""), CHAT_NOME_MAX),
                                "testo": _chat_pulisci(ris.get("testo", ""), CHAT_CITA_MAX)}
    if not testo and "pos" not in out:
        return None                       # un messaggio vuoto non e' un messaggio
    return out


def chat_pack(d):
    """Il corpo di un T_CHAT: JSON utf-8 compatto, mai oltre CHAT_CORPO_MAX.
    Ritorna None se il dizionario non e' una delle tre forme."""
    import json
    n = chat_normalizza(d)
    if n is None:
        return None
    n.pop("tipo")
    if "ciao" not in n and "testo" not in n:
        n["scrive"] = True
    while True:
        corpo = json.dumps(n, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(corpo) <= CHAT_CORPO_MAX or not n.get("testo"):
            return corpo if len(corpo) <= CHAT_CORPO_MAX else None
        n["testo"] = n["testo"][:-8]


def chat_unpack(body):
    """Dal corpo di un T_CHAT a una delle tre forme (vedi chat_normalizza),
    oppure None: troppo lungo, non utf-8, non JSON, non un oggetto, campi
    mancanti. Un corpo malformato non deve far cadere nessuno."""
    import json
    if len(body) > CHAT_CORPO_MAX:
        return None
    try:
        d = json.loads(bytes(body).decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return chat_normalizza(d)


def pack(kind, peer_id, room_id, seq, body=b""):
    return struct.pack(HEADER_FMT, MAGIC, VERSION, kind, peer_id, room_id, seq) + body


def unpack(data):
    """Ritorna (kind, peer_id, room_id, seq, body) oppure None se non e' roba nostra.

    Su UDP arriva di tutto: scanner di porte, pacchetti di sessioni vecchie,
    frammenti. Un datagramma malformato non deve far cadere il relay.
    """
    if len(data) < HEADER_SIZE:
        return None

    magic, version, kind, peer_id, room_id, seq = struct.unpack_from(HEADER_FMT, data)
    if magic != MAGIC or version != VERSION:
        return None

    return kind, peer_id, room_id, seq, data[HEADER_SIZE:]


def extract_map_key(event):
    """mapGroup e mapNum da un evento di gioco: byte 4 e 5 di struct NetEvent.

    Layout (payload/main.c): type, dir, speed, seq, mapGroup, mapNum, x:s16,
    y:s16, gender, avatarState.
    """
    if len(event) < EVENT_SIZE:
        return None
    return (event[4] << 8) | event[5]


# Tipi di evento DI GIOCO (dentro i 12 byte). Il 4 e' l'unico che il PC PRODUCE
# invece di limitarsi a inoltrarlo; il 5 serve solo a describe_event, cioe' al
# log. Nessuno dei due viene filtrato da nessuna parte: sia relay.py sia
# client.py trattano i 12 byte come opachi e non guardano mai il primo byte.
EV_LEAVE = 4
EV_STATUS = 5
EV_CARD = 6
EV_PARTY = 9  # i DETTAGLI della squadra (2026-10-16): 4 pezzi per Pokemon,
              # dir = pezzo (0..23). Solo per il sito: NON si consegna al GBA,
              # e se mandarli lo decide chi gioca (vedi squadra_in_uscita).
EV_EMOTE = 8  # un'emote sopra la testa (2026-10-16): la produce il CLIENT di
              # chi riceve, dalla chat, timbrata con lo slot di chi l'ha
              # mandata; dir 0 "!", 1 "?", 2 cuore, bit 7 = sopra di me.
EV_CLUB = 7   # "il mio GBA sta entrando al Cable Club": il payload lo emette
              # tre volte prima di mollare la porta seriale. NON si inoltra
              # come evento di gioco: il client lo consuma e avvia la
              # sessione club (T_CLUB).

# I nomi degli stati (campo `dir` di EV_STATUS), condivisi da describe_event
# e dal client, che li stampa sulle TRANSIZIONI e nella riga della sonda:
# sul fisico e' l'unico posto in cui si vede che cosa il GBA dice di fare.
STATO_NOMI = {0: "overworld", 1: "lotta", 2: "dialogo", 3: "menu",
              4: "zaino", 5: "squadra", 6: "pokedex", 7: "pokenav"}


def nome_stato(valore):
    return STATO_NOMI.get(valore, "?%d" % valore)


# struct NetEvent: type, dir, speed, seq, mapGroup, mapNum, x:s16, y:s16,
# gender, avatarState.
_EVENT_FMT = "<BBBBBBhhBB"


def make_leave_event(map_key):
    """I 12 byte che dicono al payload "l'amico se n'e' andato".

    Il gioco non ha nessun modo di emetterlo: quando un giocatore cambia mappa
    smette semplicemente di parlare, e il suo avatar resterebbe piantato sulla
    mappa vecchia. Chi lo sa e' il relay, che manda un T_BYE ai compagni di
    stanza (relay.py, move_to_room -> leave_room(notify=True) e il timeout).
    Qui quel T_BYE diventa un evento nel formato che il payload gia' capisce:
    il relay resta ignorante del protocollo di gioco, come deve.

    La mappa e' quella dell'ultimo evento visto da quel peer: senza, il payload
    lo scarterebbe come "di un'altra mappa".
    """
    return struct.pack(_EVENT_FMT, EV_LEAVE, 0, 0, 0,
                       (map_key >> 8) & 0xFF, map_key & 0xFF, 0, 0, 0, 0)


def describe_event(event):
    """Solo per i log del client: il relay non lo usa e non deve."""
    if len(event) < EVENT_SIZE:
        return "evento corto (%d byte)" % len(event)

    # Il tipo 4 non lo emette il gioco: lo sintetizza il client quando il relay
    # manda un T_BYE. Vedi Bridge.handle_udp.
    # Il tipo 5 (STATO) riusa il campo `dir` come stato invece che come
    # direzione: e' l'unico che va letto con un'altra tabella. Il tipo 6
    # (CARTA) riusa `dir` come indice del chunk e gli altri campi come byte
    # grezzi della scheda allenatore. Il bridge e il relay comunque NON li
    # distinguono - per loro i 12 byte sono opachi, e questa funzione serve
    # soltanto al log.
    kinds = {1: "PASSO", 2: "SYNC", 3: "GIRA", 4: "VIA", 5: "STATO",
             6: "CARTA", 7: "CLUB"}
    dirs = {0: "-", 1: "giu", 2: "su", 3: "sx", 4: "dx"}
    states = STATO_NOMI
    kind, direction, speed, seq, map_g, map_n = event[0:6]
    x, y = struct.unpack_from("<hh", event, 6)

    if kind == EV_STATUS:
        return "#%3d %-5s mappa %d.%d %s" % (
            seq, kinds[kind], map_g, map_n,
            states.get(direction, "?%d" % direction))

    if kind == EV_CARD:
        return "#%3d %-5s mappa %d.%d chunk %d/13" % (
            seq, kinds[kind], map_g, map_n, direction)

    if kind == EV_PARTY:
        return "#%3d DETT. mappa %d.%d pezzo %d (Pokemon %d)" % (
            seq, map_g, map_n, direction, direction >> 2)

    if kind == EV_EMOTE:
        e = direction & 0x7F
        return "#%3d EMOTE %s%s" % (seq, ("!", "?", "cuore")[e] if e < 3 else "?%d" % e,
                                    " (mia)" if direction & 0x80 else "")

    return "#%3d %-5s mappa %d.%d (%d,%d) %s" % (
        seq, kinds.get(kind, "?%d" % kind), map_g, map_n, x, y,
        dirs.get(direction, "?"))


# --- la squadra nella scheda (2026-10-16) --------------------------------------
# Il payload la scrive nei byte che Smeraldo lascia a zero nella parte link
# della scheda (CARD_PARTY_* in payload/main.c), che viaggia gia' a pezzi in
# EV_CARD. Gemella di squadraDaScheda in web/js/bridge.js.
CARD_SIZE = 96
CARD_CHUNK_BYTES = 7
CARD_CHUNK_OFF = (2, 6, 7, 8, 9, 10, 11)   # kCardOff del payload
PARTY_CHUNKS = (1 << 9) | (1 << 10) | (1 << 12) | (1 << 13)
SPECIES_EGG = 412


def card_put_chunk(card, event):
    """Mette nel bytearray `card` (96 byte) i 7 byte di un EV_CARD. Ritorna il
    bit del pezzo, o 0 se l'indice e' fuori."""
    idx = event[1]
    if idx >= 14:
        return 0
    for k, off in enumerate(CARD_CHUNK_OFF):
        if idx * CARD_CHUNK_BYTES + k < CARD_SIZE:
            card[idx * CARD_CHUNK_BYTES + k] = event[off]
    return 1 << idx


def party_from_card(card):
    """I 96 byte di una scheda -> [{specie, lv, cromatico, ko, uovo}] o None se
    dentro non c'e' una squadra. Una specie oltre l'uovo vuol dire byte che non
    sono una squadra (payload vecchio, o spazzatura): None."""
    out = []
    for i in range(6):
        sp = card[0x54 + i * 2] | (card[0x55 + i * 2] << 8)
        if not sp:
            continue
        if sp > SPECIES_EGG:
            return None
        out.append({"specie": sp, "lv": card[0x44 + i],
                    "cromatico": bool((card[0x4A] >> i) & 1),
                    "ko": bool((card[0x4B] >> i) & 1), "uovo": sp == SPECIES_EGG})
    return out or None


# --- i dettagli della squadra (2026-10-16) --------------------------------------
# Il record di un Pokemon: PARTY_REC byte = 4 pezzi EV_PARTY da 7 (layout in
# payload/main.c, PARTY_REC). Gemello di dettagliDaRecord in web/js/bridge.js.
PARTY_REC = 28
STATI = ((0x07, "sonno"), (0x08, "veleno"), (0x10, "scottatura"),
         (0x20, "congelamento"), (0x40, "paralisi"), (0x80, "veleno grave"))


def party_details_put_chunk(store, event):
    """Mette nel bytearray `store` (6 * PARTY_REC) i 7 byte di un EV_PARTY.
    Ritorna il bit del pezzo (0..23), o 0 se fuori."""
    idx = event[1]
    if idx >= 24:
        return 0
    for k, off in enumerate(CARD_CHUNK_OFF):
        store[idx * CARD_CHUNK_BYTES + k] = event[off]
    return 1 << idx


def party_details(rec):
    """I PARTY_REC byte di un Pokemon -> dizionario. Il soprannome resta nei
    byte del gioco (lo decodifica chi ha la tabella dei caratteri: il sito)."""
    u16 = lambda o: rec[o] | (rec[o + 1] << 8)  # noqa: E731
    stato = rec[11]
    return {"soprannome": bytes(rec[0:10]), "lv": rec[10],
            "stato": next((n for m, n in STATI if stato & m), None),
            "ps": u16(12), "psMax": u16(14), "strumento": u16(16),
            "mosse": [u16(18 + i * 2) for i in range(4)],
            "natura": rec[26] if rec[26] < 25 else None,
            "sesso": {0: "m", 0xFE: "f"}.get(rec[27])}


# I byte della squadra dentro la scheda (CARD_PARTY_*): livelli, maschere,
# specie. La privacy "niente" li azzera nei pezzi in USCITA.
_CARD_PARTY = set(range(0x44, 0x4C)) | set(range(0x54, 0x60))


def squadra_in_uscita(event, modo):
    """Il filtro della privacy, sui pezzi che il NOSTRO GBA manda alla stanza.
    modo: "tutta" (si manda tutto), "base" (specie e livelli si', dettagli no),
    "niente" (neanche quelli). Ritorna l'evento da spedire, o None."""
    if modo == "tutta" or not event:
        return event
    if event[0] == EV_PARTY:
        return None
    if event[0] == EV_CARD and modo == "niente":
        e = bytearray(event)
        for k, off in enumerate(CARD_CHUNK_OFF):
            if event[1] * CARD_CHUNK_BYTES + k in _CARD_PARTY:
                e[off] = 0
        return bytes(e)
    return event
