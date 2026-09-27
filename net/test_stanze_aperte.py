#!/usr/bin/env python3
"""
test_stanze_aperte.py - l'elenco delle STANZE APERTE (2026-09-27), con relay.py
e relay_ws.py veri, come li usa il sito (GET /ws?stanze).

Criteri:
  1. nessuna stanza e' aperta da sola: con giocatori in stanza ma senza
     T_PUBLIC l'elenco e' vuoto;
  2. un giocatore apre la sua stanza: compare, coi giocatori e gli spettatori
     contati a parte;
  3. uno SPETTATORE non puo' aprire una stanza, e nemmeno chi sta in
     un'altra stanza;
  4. T_PUBLIC 0 la richiude subito;
  5. il segno SCADE da solo se non viene rinnovato (PUBBLICA_S), cosi' una
     scheda chiusa o un relay riavviato non lasciano stanze fantasma;
  6. una stanza che si svuota sparisce anche col segno ancora valido.

    python test_stanze_aperte.py        (~25 s: il punto 5 aspetta la scadenza)
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from protocol import T_BYE, T_HELLO, T_PUBLIC, T_WATCH, pack  # noqa: E402
from relay import PUBBLICA_S  # noqa: E402

PY = sys.executable
RELAY_PORT = 19031
WS_PORT = 19032
ROOM_A = 47031
ROOM_B = 47032


def udp():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    return s


def elenco():
    # relay_ws chiede l'elenco al relay una volta al secondo: si aspetta un
    # giro e mezzo prima di leggere.
    time.sleep(1.5)
    with urllib.request.urlopen("http://127.0.0.1:%d/ws?stanze" % WS_PORT, timeout=3) as r:
        return json.loads(r.read().decode("utf-8"))


def stanza(dati, room):
    for s in dati.get("stanze", []):
        if s["stanza"] == room:
            return s
    return None


def main():
    relay_addr = ("127.0.0.1", RELAY_PORT)
    procs = [
        subprocess.Popen([PY, "relay.py", "--port", str(RELAY_PORT), "--timeout", "60"], cwd=HERE,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding="utf-8", errors="replace"),
        subprocess.Popen([PY, "relay_ws.py", "--port", str(WS_PORT), "--bind", "127.0.0.1",
                          "--relay", "127.0.0.1:%d" % RELAY_PORT], cwd=HERE,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding="utf-8", errors="replace"),
    ]
    try:
        time.sleep(0.8)
        for p in procs:
            if p.poll() is not None:
                raise RuntimeError("un processo e' morto in avvio")

        g1, g2, g3, spett, altro = udp(), udp(), udp(), udp(), udp()
        g1.sendto(pack(T_HELLO, 1, ROOM_A, 0), relay_addr)
        g2.sendto(pack(T_HELLO, 2, ROOM_A, 0), relay_addr)
        g3.sendto(pack(T_HELLO, 3, ROOM_A, 0), relay_addr)
        spett.sendto(pack(T_WATCH, 9, ROOM_A, 0), relay_addr)
        altro.sendto(pack(T_HELLO, 5, ROOM_B, 0), relay_addr)

        d = elenco()
        assert d.get("stanze") == [], "PASSO 1: stanze aperte da sole: %r" % d
        print("PASSO 1: giocatori in stanza, nessun T_PUBLIC -> elenco vuoto")

        g1.sendto(pack(T_PUBLIC, 1, ROOM_A, 0, b"\x01"), relay_addr)
        d = elenco()
        s = stanza(d, ROOM_A)
        assert s == {"stanza": ROOM_A, "giocatori": 3, "spettatori": 1}, "PASSO 2: %r" % d
        assert stanza(d, ROOM_B) is None, "PASSO 2: la stanza privata compare: %r" % d
        assert d.get("posti") == 4
        print("PASSO 2: stanza aperta da un giocatore -> 3 giocatori + 1 spettatore; la privata no")

        spett.sendto(pack(T_PUBLIC, 9, ROOM_A, 0, b"\x00"), relay_addr)   # lo spettatore prova a chiuderla
        altro.sendto(pack(T_PUBLIC, 5, ROOM_A, 0, b"\x00"), relay_addr)   # chi sta in B prova a chiudere A
        spett.sendto(pack(T_PUBLIC, 9, ROOM_B, 0, b"\x01"), relay_addr)   # e ad aprire B
        d = elenco()
        assert stanza(d, ROOM_A) is not None, "PASSO 3: spettatore/estraneo hanno chiuso A: %r" % d
        assert stanza(d, ROOM_B) is None, "PASSO 3: lo spettatore ha aperto B: %r" % d
        print("PASSO 3: spettatori ed estranei non aprono e non chiudono")

        g2.sendto(pack(T_PUBLIC, 2, ROOM_A, 0, b"\x00"), relay_addr)
        d = elenco()
        assert stanza(d, ROOM_A) is None, "PASSO 4: T_PUBLIC 0 non chiude: %r" % d
        print("PASSO 4: T_PUBLIC 0 da un giocatore la richiude")

        g1.sendto(pack(T_PUBLIC, 1, ROOM_A, 0, b"\x01"), relay_addr)
        assert stanza(elenco(), ROOM_A) is not None
        # I giocatori restano (i PING tengono vivi i peer: qui --timeout 60),
        # ma nessuno rinnova il segno.
        time.sleep(PUBBLICA_S + 0.5)
        d = elenco()
        assert stanza(d, ROOM_A) is None, "PASSO 5: il segno non scade: %r" % d
        print("PASSO 5: senza rinnovo la stanza esce dall'elenco dopo %.0f s" % PUBBLICA_S)

        altro.sendto(pack(T_PUBLIC, 5, ROOM_B, 0, b"\x01"), relay_addr)
        assert stanza(elenco(), ROOM_B) is not None, "PASSO 6: B non si apre"
        altro.sendto(pack(T_BYE, 5, ROOM_B, 0), relay_addr)
        d = elenco()
        assert stanza(d, ROOM_B) is None, "PASSO 6: stanza vuota ancora in elenco: %r" % d
        print("PASSO 6: la stanza che si svuota sparisce subito")

        print("\nTUTTO OK")
        return 0
    except AssertionError as exc:
        print("FALLITO: %s" % exc)
        return 1
    finally:
        for p in procs:
            p.terminate()
        for p in procs:
            try:
                out = p.communicate(timeout=3)[0]
            except subprocess.TimeoutExpired:
                p.kill()
                out = p.communicate()[0]
            righe = [r for r in out.splitlines() if "APERTA" in r or "privata" in r or "non piu' aperta" in r]
            for r in righe:
                print("  log: " + r)


if __name__ == "__main__":
    sys.exit(main())
