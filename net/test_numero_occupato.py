#!/usr/bin/env python3
"""
test_numero_occupato.py - il peer-id gia' in uso nella stanza (2026-09-27).

Richiesta di Lain: «verifica che il peer selezionato sia disponibile e non sia
utilizzato gia' da altri, sia per visitatori che per giocatori». Il relay vero,
socket UDP veri, i client finti mandano quello che mandano i client nuovi: un
codice di sessione di 4 byte nel corpo di PING, HELLO e WATCH.

Criteri:
  1. due GIOCATORI con lo stesso numero e codici diversi: il secondo riceve
     T_TAKEN (corpo 0 = lo usa un giocatore) e resta fuori (non riceve gli
     eventi della stanza e i suoi non arrivano a nessuno); il primo non si
     accorge di niente;
  2. lo STESSO client che rientra da una porta nuova (stesso codice, vecchio
     indirizzo ancora "vivo"): entra subito, niente T_TAKEN - e' il rebinding
     NAT / WebSocket riaperto;
  3. uno SPETTATORE col numero di un giocatore vivo: T_TAKEN (corpo 0); un
     GIOCATORE col numero di uno spettatore vivo: T_TAKEN (corpo 1);
  4. il T_TAKEN parte al massimo una volta al secondo per peer;
  5. un EVENTO da un indirizzo nuovo, prima del suo PING, non entra e non
     riceve T_TAKEN: si aspetta il PING che porta il codice;
  6. quando il vecchio tace da piu' di VIVO_S (5 s), il nuovo entra;
  7. il log del relay dice RIFIUTATO una volta per peer e stanza.

    python test_numero_occupato.py      (~15 s)
"""

import os
import socket
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from protocol import (T_EVENT, T_HELLO, T_PING, T_TAKEN, T_WATCH,  # noqa: E402
                      pack, unpack)

PY = sys.executable
RELAY_PORT = 19041
ROOM = 47041
EVENT = bytes(range(12))
R = ("127.0.0.1", RELAY_PORT)


def codice(n):
    return n.to_bytes(4, "little")


def udp():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    return s


def ricevi(sock, finestra=0.6):
    """Tutti i datagrammi arrivati nella finestra, gia' spacchettati."""
    fine = time.monotonic() + finestra
    out = []
    while True:
        resto = fine - time.monotonic()
        if resto <= 0:
            return out
        sock.settimeout(resto)
        try:
            out.append(unpack(sock.recvfrom(2048)[0]))
        except socket.timeout:
            return out


def tipi(pacchetti, kind):
    return [p for p in pacchetti if p and p[0] == kind]


def main():
    proc = subprocess.Popen(
        [PY, "relay.py", "--port", str(RELAY_PORT), "--timeout", "30"], cwd=HERE,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace")
    try:
        time.sleep(0.5)
        assert proc.poll() is None, "il relay e' morto in avvio"

        # --- 1. due giocatori, stesso numero, codici diversi ---------------
        a, terzo = udp(), udp()
        a.sendto(pack(T_HELLO, 7, ROOM, 0, codice(111)), R)
        terzo.sendto(pack(T_HELLO, 9, ROOM, 0, codice(999)), R)
        time.sleep(0.2)
        b = udp()
        b.sendto(pack(T_HELLO, 7, ROOM, 0, codice(222)), R)
        rb = ricevi(b)
        presi = tipi(rb, T_TAKEN)
        assert len(presi) == 1 and presi[0][4] == b"\x00", ("il secondo 7 doveva ricevere un T_TAKEN (giocatore)", rb)
        terzo.sendto(pack(T_EVENT, 9, ROOM, 1, EVENT), R)
        ra, rb = ricevi(a), ricevi(b)
        assert tipi(ra, T_EVENT), "il primo 7 ha perso la stanza: doveva restare dentro"
        assert not tipi(rb, T_EVENT), "il secondo 7 riceve gli eventi: doveva restare fuori"
        b.sendto(pack(T_EVENT, 7, ROOM, 2, EVENT), R)
        assert not tipi(ricevi(terzo), T_EVENT), "l'evento del secondo 7 e' arrivato: doveva restare fuori"
        print("PASSO 1: due giocatori col 7: il secondo riceve T_TAKEN e resta fuori, il primo non si accorge di niente")

        # --- 4. al massimo un T_TAKEN al secondo ---------------------------
        for i in range(5):
            b.sendto(pack(T_PING, 7, ROOM, 10 + i, codice(222)), R)
            time.sleep(0.05)
        rb = ricevi(b, 0.5)
        assert len(tipi(rb, T_TAKEN)) <= 1, ("troppi T_TAKEN in mezzo secondo", len(tipi(rb, T_TAKEN)))
        print("PASSO 4: cinque PING in 0,25 s -> al massimo un T_TAKEN")

        # --- 2. lo stesso client da una porta nuova: rientra ---------------
        a2 = udp()
        a2.sendto(pack(T_PING, 7, ROOM, 20, codice(111)), R)
        ra2 = ricevi(a2)
        assert not tipi(ra2, T_TAKEN), ("lo stesso client (stesso codice) doveva rientrare, non essere rifiutato", ra2)
        terzo.sendto(pack(T_EVENT, 9, ROOM, 3, EVENT), R)
        assert tipi(ricevi(a2), T_EVENT), "il 7 rientrato dalla porta nuova non riceve gli eventi"
        print("PASSO 2: stesso codice da una porta nuova -> rientro immediato, niente T_TAKEN")
        a.close()
        a = a2

        # --- 3. spettatore contro giocatore, nei due versi -----------------
        sp = udp()
        sp.sendto(pack(T_WATCH, 9, ROOM, 0, codice(333)), R)
        rsp = ricevi(sp)
        presi = tipi(rsp, T_TAKEN)
        assert len(presi) == 1 and presi[0][4] == b"\x00", ("lo spettatore col numero di un giocatore vivo doveva ricevere T_TAKEN(0)", rsp)
        sp2 = udp()
        sp2.sendto(pack(T_WATCH, 50, ROOM, 0, codice(444)), R)
        assert not tipi(ricevi(sp2), T_TAKEN), "uno spettatore col numero libero non doveva essere rifiutato"
        g = udp()
        g.sendto(pack(T_HELLO, 50, ROOM, 0, codice(555)), R)
        rg = ricevi(g)
        presi = tipi(rg, T_TAKEN)
        assert len(presi) == 1 and presi[0][4] == b"\x01", ("un giocatore col numero di uno spettatore vivo doveva ricevere T_TAKEN(1)", rg)
        print("PASSO 3: spettatore sul numero di un giocatore -> T_TAKEN(0); giocatore sul numero di uno spettatore -> T_TAKEN(1)")

        # --- 5. un evento prima del PING non entra e non e' rifiutato ------
        e = udp()
        e.sendto(pack(T_EVENT, 9, ROOM, 5, EVENT), R)
        re_ = ricevi(e)
        assert not tipi(re_, T_TAKEN), "un evento senza codice non deve produrre un T_TAKEN (si aspetta il PING)"
        assert not tipi(ricevi(a), T_EVENT), "l'evento del 9 da un indirizzo nuovo e' passato: non doveva entrare"
        e.sendto(pack(T_PING, 9, ROOM, 6, codice(999)), R)
        assert not tipi(ricevi(e), T_TAKEN), "il PING col codice giusto (quello del 9) doveva farlo rientrare"
        print("PASSO 5: evento senza codice da un indirizzo nuovo -> non entra, niente T_TAKEN; col PING giusto rientra")
        terzo.close()
        terzo = e

        # --- 6. il vecchio tace: il nuovo entra ---------------------------
        # a (il primo 7) batte un'ultima volta e poi tace; b (il secondo 7)
        # continua a battere ogni mezzo secondo.
        a.sendto(pack(T_PING, 7, ROOM, 29, codice(111)), R)
        ricevi(a, 0.1)
        inizio = time.monotonic()
        fine = inizio + 7.0
        rifiuti_t = []
        while time.monotonic() < fine:
            terzo.sendto(pack(T_PING, 9, ROOM, 30, codice(999)), R)   # il 9 resta vivo
            b.sendto(pack(T_PING, 7, ROOM, 31, codice(222)), R)
            if tipi(ricevi(b, 0.5), T_TAKEN):
                rifiuti_t.append(time.monotonic() - inizio)
        assert rifiuti_t and rifiuti_t[0] < 2.0, ("finche' il vecchio 7 era vivo, il nuovo doveva essere rifiutato", rifiuti_t)
        assert rifiuti_t[-1] < 6.0, ("dopo 5 s di silenzio del vecchio, niente piu' T_TAKEN", rifiuti_t)
        terzo.sendto(pack(T_EVENT, 9, ROOM, 32, EVENT), R)
        assert tipi(ricevi(b), T_EVENT), "dopo 5 s di silenzio del vecchio 7, il nuovo doveva essere entrato"
        print("PASSO 6: il vecchio 7 tace da piu' di 5 s -> il nuovo 7 entra")
    finally:
        proc.terminate()
        try:
            log = proc.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            proc.kill()
            log = proc.communicate()[0]

    rifiuti = [r for r in log.splitlines() if "RIFIUTATO" in r]
    per_peer = {}
    for r in rifiuti:
        chiave = r.split(" da ")[0]
        per_peer[chiave] = per_peer.get(chiave, 0) + 1
    assert rifiuti, "il relay non ha mai scritto RIFIUTATO nel log"
    assert all(n == 1 for n in per_peer.values()) or len(rifiuti) <= 4, ("RIFIUTATO ripetuto", rifiuti)
    print("PASSO 7: il relay scrive RIFIUTATO (%d righe, una per peer e stanza)" % len(rifiuti))
    print("\nNUMERO OCCUPATO: PASSATO")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print("\nNUMERO OCCUPATO: FALLITO -", exc)
        sys.exit(1)
