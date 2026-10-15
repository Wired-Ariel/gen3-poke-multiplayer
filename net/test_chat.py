#!/usr/bin/env python3
"""
test_chat.py - regressione della CHAT DELLA STANZA (T_CHAT, 2026-10-11).

Relay vero (relay.py) e relay_ws.py vero davanti; i client sono socket UDP e
un WebSocket fatto a mano, come negli altri test. Ogni passo ha il suo
criterio, e il log del relay fa parte del criterio.

  1. inoltro: un messaggio arriva a tutti gli altri giocatori della stanza,
     e NON torna a chi l'ha scritto;
  2. lo SPETTATORE lo riceve;
  3. lo SPETTATORE puo' scrivere (l'eccezione voluta: i suoi T_EVENT restano
     rifiutati, e lo si controlla qui accanto);
  4. un'altra stanza non sente niente;
  5. il corpo troppo lungo non passa;
  6. il limite di frequenza: oltre CHAT_MAX in CHAT_FINESTRA_S il relay frena;
  7. dedup: lo stesso datagramma consegnato due volte dal relay diventa UN
     messaggio per client.py (Bridge.handle_chat), e protocol.chat_unpack
     butta via cio' che non e' un messaggio;
  8. relay_ws.py non interpreta: un T_CHAT entra da WebSocket ed esce su UDP
     byte per byte, e viceversa.

    D:\\Progettini\\Python313\\python.exe net\\test_chat.py
"""

import base64
import json
import os
import socket
import struct
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from protocol import (  # noqa: E402
    CHAT_CORPO_MAX, CHAT_TESTO_MAX, T_CHAT, T_EVENT, T_HELLO, T_WATCH,
    chat_pack, chat_unpack, pack, unpack,
)
import relay as modulo_relay  # noqa: E402

PY = sys.executable
RELAY_PORT = 19031
WS_PORT = 19032
ROOM = 47110
EVENT = bytes(range(12))


def udp():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    s.settimeout(2.0)
    return s


def recv_or_none(sock, timeout=1.0):
    sock.settimeout(timeout)
    try:
        return sock.recvfrom(4096)[0]
    except socket.timeout:
        return None


def chat_or_none(sock, timeout=1.0):
    """Il prossimo T_CHAT, saltando il resto (PONG, eventi)."""
    fine = time.monotonic() + timeout
    while time.monotonic() < fine:
        d = recv_or_none(sock, max(0.05, fine - time.monotonic()))
        if d is None:
            return None
        p = unpack(d)
        if p and p[0] == T_CHAT:
            return p
    return None


def scarica(sock):
    while recv_or_none(sock, timeout=0.15) is not None:
        pass


def msg(ident, testo, nome="Marta", **altro):
    d = {"id": ident, "nome": nome, "testo": testo, "ts": int(time.time() * 1000)}
    d.update(altro)
    return chat_pack(d)


class Ws:
    """Un client WebSocket minimo (RFC 6455), come in test_relay_ws.py."""

    def __init__(self, port):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=3)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        req = ("GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
               "Sec-WebSocket-Version: 13\r\n\r\n" % key)
        self.sock.sendall(req.encode("ascii"))
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        assert b" 101 " in buf.split(b"\r\n", 1)[0], buf[:80]
        self.buf = buf.split(b"\r\n\r\n", 1)[1]

    def send(self, payload):
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            head = bytes([0x82, 0x80 | n])
        else:
            head = bytes([0x82, 0x80 | 126]) + struct.pack(">H", n)
        self.sock.sendall(head + mask + bytes(b ^ mask[i & 3] for i, b in enumerate(payload)))

    def _frame(self):
        """Un frame intero dal buffer, oppure None se non c'e' ancora."""
        if len(self.buf) < 2:
            return None
        ln = self.buf[1] & 0x7F
        pos = 2
        if ln == 126:
            if len(self.buf) < 4:
                return None
            ln = struct.unpack_from(">H", self.buf, 2)[0]
            pos = 4
        if len(self.buf) < pos + ln:
            return None
        op = self.buf[0] & 0x0F
        out = self.buf[pos:pos + ln]
        self.buf = self.buf[pos + ln:]
        return op, out

    def recv(self, timeout=2.0):
        """Il prossimo messaggio binario, oppure None allo scadere."""
        self.sock.settimeout(timeout)
        try:
            while True:
                f = self._frame()
                if f is not None:
                    if f[0] == 2:
                        return f[1]
                    continue
                d = self.sock.recv(4096)
                if not d:
                    return None
                self.buf += d
        except socket.timeout:
            return None

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def main():
    relay_addr = ("127.0.0.1", RELAY_PORT)
    procs = []
    ok = True
    out = ""
    try:
        procs.append(subprocess.Popen(
            [PY, "relay.py", "--port", str(RELAY_PORT)], cwd=HERE,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace"))
        procs.append(subprocess.Popen(
            [PY, "relay_ws.py", "--port", str(WS_PORT), "--bind", "127.0.0.1",
             "--relay", "127.0.0.1:%d" % RELAY_PORT], cwd=HERE,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        time.sleep(0.7)
        for p in procs:
            if p.poll() is not None:
                raise RuntimeError("relay o relay_ws sono morti in avvio")

        a, b, c = udp(), udp(), udp()
        for i, s in enumerate((a, b, c), start=1):
            s.sendto(pack(T_HELLO, i, ROOM, 0), relay_addr)
        spett = udp()
        spett.sendto(pack(T_WATCH, 90, ROOM, 0), relay_addr)
        fuori = udp()
        fuori.sendto(pack(T_HELLO, 7, ROOM + 1, 0), relay_addr)
        time.sleep(0.3)

        # --- 1. inoltro ------------------------------------------------------
        corpo = msg("m-1", "Ci vediamo al Centro Pok\u00e9mon")
        a.sendto(pack(T_CHAT, 1, ROOM, 0, corpo), relay_addr)
        for nome, s in (("B", b), ("C", c)):
            p = chat_or_none(s)
            assert p is not None, "il messaggio non arriva al giocatore %s" % nome
            assert p[1] == 1 and p[4] == corpo, "il messaggio a %s e' cambiato per strada" % nome
        assert chat_or_none(a, 0.4) is None, "il messaggio e' tornato a chi l'ha scritto"
        print("PASSO 1: il messaggio arriva agli altri giocatori, intatto, e non torna indietro")

        # --- 2. lo spettatore riceve -----------------------------------------
        p = chat_or_none(spett)
        assert p is not None and p[4] == corpo, "lo SPETTATORE non riceve la chat"
        print("PASSO 2: lo spettatore riceve la chat")

        # --- 3. lo spettatore scrive (e i suoi eventi restano rifiutati) -----
        for s in (a, b, c):
            scarica(s)
        corpo_s = msg("m-2", "ciao dalla mappa", nome="Sara")
        spett.sendto(pack(T_CHAT, 90, ROOM, 0, corpo_s), relay_addr)
        p = chat_or_none(a)
        assert p is not None and p[1] == 90 and p[4] == corpo_s, (
            "il messaggio dello SPETTATORE non arriva ai giocatori")
        scarica(b)
        spett.sendto(pack(T_EVENT, 90, ROOM, 1, EVENT), relay_addr)
        assert recv_or_none(b, 0.5) is None, (
            "un T_EVENT dello spettatore e' stato inoltrato: l'eccezione vale SOLO per la chat")
        print("PASSO 3: lo spettatore scrive in chat; i suoi eventi restano rifiutati")

        # --- 4. un'altra stanza non sente ------------------------------------
        assert chat_or_none(fuori, 0.4) is None, "la chat e' uscita dalla stanza"
        print("PASSO 4: la stanza accanto non sente niente")

        # --- 5. corpo troppo lungo -------------------------------------------
        for s in (a, b, c, spett):
            scarica(s)
        a.sendto(pack(T_CHAT, 1, ROOM, 0, b"x" * (CHAT_CORPO_MAX + 1)), relay_addr)
        assert chat_or_none(b, 0.4) is None, "un corpo oltre CHAT_CORPO_MAX e' passato"
        lungo = msg("m-3", "\U0001F600" * 400)
        assert lungo is not None and len(lungo) <= CHAT_CORPO_MAX, "chat_pack non accorcia"
        assert len(chat_unpack(lungo)["testo"]) <= CHAT_TESTO_MAX
        a.sendto(pack(T_CHAT, 1, ROOM, 0, lungo), relay_addr)
        assert chat_or_none(b, 1.0) is not None, "un messaggio lungo ma lecito non passa"
        print("PASSO 5: oltre %d byte non passa; chat_pack accorcia e il lecito passa (%d byte)"
              % (CHAT_CORPO_MAX, len(lungo)))

        # --- 6. limite di frequenza ------------------------------------------
        # C non ha ancora scritto: parte da zero.
        for s in (a, b, c, spett):
            scarica(s)
        mandati = modulo_relay.CHAT_MAX + 6
        for i in range(mandati):
            c.sendto(pack(T_CHAT, 3, ROOM, 0, msg("raffica-%d" % i, "spam %d" % i)), relay_addr)
        time.sleep(0.4)
        arrivati = 0
        while chat_or_none(a, 0.3) is not None:
            arrivati += 1
        assert arrivati == modulo_relay.CHAT_MAX, (
            "limite di frequenza: mandati %d, arrivati %d, attesi %d"
            % (mandati, arrivati, modulo_relay.CHAT_MAX))
        # ...e chi non ha esagerato parla ancora.
        b.sendto(pack(T_CHAT, 2, ROOM, 0, msg("m-4", "io posso")), relay_addr)
        assert chat_or_none(a) is not None, "il freno di un peer ha zittito anche gli altri"
        print("PASSO 6: %d messaggi in raffica, ne passano %d; gli altri peer non sono frenati"
              % (mandati, arrivati))

        # --- 7. dedup e pulizia (lato client) --------------------------------
        import client as modulo_client

        class Finto(modulo_client.Bridge):
            def __init__(self):       # niente socket: serve solo handle_chat
                self.peer_id = 5
                self.room = ROOM
                self.chat = []
                self.chat_visti = {}
                self.chat_nomi = {}
                self.chat_ricevuti = self.chat_doppi = self.chat_illeggibili = 0
                self.pos_sporche = False
                self.righe = []

            def log(self, m):
                self.righe.append(m)

        f = Finto()
        doppio = msg("m-5", "una volta sola")
        f.handle_chat(1, doppio)
        f.handle_chat(1, doppio)                       # la consegna UDP duplicata
        f.handle_chat(1, chat_pack({"scrive": True, "nome": "Marta"}))
        f.handle_chat(90, chat_pack({"ciao": 1, "nome": "Sara", "ruolo": "s"}))
        f.handle_chat(1, b"\xff\xfe non json")
        f.handle_chat(1, json.dumps({"id": "x", "testo": "", "ts": 1}).encode())
        f.handle_chat(1, json.dumps([1, 2, 3]).encode())
        assert len(f.chat) == 1 and f.chat_doppi == 1, (
            "dedup sull'id: %d messaggi tenuti, %d doppi" % (len(f.chat), f.chat_doppi))
        assert f.chat_illeggibili == 3, "i corpi malformati contati sono %d" % f.chat_illeggibili
        assert f.chat_nomi == {1: "Marta", 90: "Sara"}, f.chat_nomi
        assert sum(1 for r in f.righe if r.startswith("[chat ] Marta: una volta sola")) == 1
        sporco = chat_unpack(json.dumps({
            "id": "y", "nome": "N" * 40, "ts": 5,
            "testo": "riga\nuno\x00" + "z" * 400,
            "pos": {"g": 0, "n": 9, "x": 14, "y": 9},
            "rispondeA": {"id": "m-1", "nome": "Gio", "testo": "q" * 300},
            "estraneo": {"a": 1}}).encode())
        assert len(sporco["nome"]) == 16 and len(sporco["testo"]) == CHAT_TESTO_MAX
        assert "\n" not in sporco["testo"] and "\x00" not in sporco["testo"]
        assert sporco["pos"] == {"g": 0, "n": 9, "x": 14, "y": 9} and "estraneo" not in sporco
        assert len(sporco["rispondeA"]["testo"]) == 80
        senza = chat_unpack(json.dumps({"id": "z", "testo": "x", "ts": 1,
                                        "pos": {"g": "0", "n": 9, "x": 1, "y": 1}}).encode())
        assert senza is not None and "pos" not in senza, "una posizione malformata e' passata"
        print("PASSO 7: client.py tiene un messaggio per id (1 doppio scartato), "
              "conta 3 corpi malformati, impara i nomi; chat_unpack pulisce e taglia")

        # --- 8. relay_ws non interpreta --------------------------------------
        for s in (a, b, c, spett):
            scarica(s)
        ws = Ws(WS_PORT)
        ws.send(pack(T_WATCH, 91, ROOM, 0))
        time.sleep(0.3)
        corpo_w = msg("m-6", "dal browser: \u00e8 gi\u00e0 l\u00ec? \u2713", nome="Web")
        ws.send(pack(T_CHAT, 91, ROOM, 0, corpo_w))
        p = chat_or_none(a)
        assert p is not None and p[1] == 91 and p[4] == corpo_w, (
            "WebSocket -> UDP: il T_CHAT non e' arrivato byte per byte")
        corpo_u = msg("m-7", "x" * 280, nome="Udp")      # > 125 byte: frame esteso
        a.sendto(pack(T_CHAT, 1, ROOM, 0, corpo_u), relay_addr)
        ricevuto = None
        fine = time.monotonic() + 2.0
        while time.monotonic() < fine:
            d = ws.recv(0.5)
            if d is None:
                continue
            pp = unpack(d)
            if pp and pp[0] == T_CHAT:
                ricevuto = pp
                break
        assert ricevuto is not None and ricevuto[4] == corpo_u, (
            "UDP -> WebSocket: il T_CHAT non e' arrivato byte per byte")
        ws.close()
        print("PASSO 8: relay_ws.py porta il T_CHAT nei due versi senza toccarlo")

        for s in (a, b, c, spett, fuori):
            s.close()
    except Exception as exc:
        ok = False
        print("FALLITO: %s" % exc)
    finally:
        for p in procs:
            p.terminate()
        try:
            out = procs[0].communicate(timeout=2)[0] if procs else ""
        except subprocess.TimeoutExpired:
            procs[0].kill()
            out = procs[0].communicate()[0]

    if ok:
        if out.count("scrive TROPPO in chat") != 1:
            ok = False
            print("FALLITO: il freno doveva essere detto UNA volta nel log, e' stato detto %d"
                  % out.count("scrive TROPPO in chat"))
        elif "SPETTATORE ma manda eventi" not in out:
            ok = False
            print("FALLITO: l'evento rifiutato allo spettatore non e' nel log")
        else:
            print("PASSO 9: il log dice il freno (una volta) e l'evento rifiutato allo spettatore")
    if not ok:
        print("--- log relay ---")
        print(out)

    print("\nREGRESSIONE CHAT: " + ("PASSATA" if ok else "FALLITA"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
