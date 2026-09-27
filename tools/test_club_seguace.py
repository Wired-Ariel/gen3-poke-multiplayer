#!/usr/bin/env python3
"""
test_club_seguace.py - la saletta del Cable Club, GBA fisico <-> mGBA, col Lua
VERO (2026-09-27).

IL DIFETTO: nella saletta i passi si sfasano (vedi tools/sim_saletta.py e NOTES).
LA CURA: il Pico riferisce ogni trasferimento come coppia e mgba/club_lua.lua,
in modo SEGUACE, fa vedere al gioco esattamente quelle coppie.

COSA PROVA. Esegue mgba/club_lua.lua intero con lupa. Al posto di mGBA c'e' una
memoria finta con le code del link del gioco (gLink: sendQueue/recvQueue, i
layout di include/link.h come li legge il Lua), e un gioco finto che a ogni
frame legge UNA coppia dalla coda di ricezione e muove i due personaggi come
fa overworld.c (passo al tasto se libero, poi 16 frame bloccato). Dall'altra
parte un GBA finto a 59,7275 Hz, il Pico (FIFO dei comandi di mGBA, zeri se
vuota, coppia riferita come la F-5 di usbSection.hpp) e una rete con ritardo
e jitter. Si contano i passi di ciascun personaggio visti da ciascun gioco.

  - modo SEGUACE (il sito dice CAPS_DECISO|CAPS_COPPIE): i due giochi devono
    contare gli stessi passi, sempre;
  - modo DI PRIMA (sito senza capacita'): il test deve VEDERE il difetto, o non
    proverebbe niente;
  - una riapertura a meta' (la macchina degli scambi): le coppie della sezione
    chiusa non devono finire nella nuova.

    D:\\Progettini\\Python313\\python.exe tools\\test_club_seguace.py
"""

import os
import random
import struct
import unittest

try:
    import lupa
except ImportError:            # pragma: no cover
    lupa = None

QUI = os.path.dirname(os.path.abspath(__file__))
CLUB = os.path.join(os.path.dirname(QUI), "mgba", "club_lua.lua")

ADDR_gLink = 0x03003170
ADDR_gLinkCallback = 0x03003140
VBLANK = 0x030022E0
L_STATE = 0x001
L_SENDQ, L_RECVQ = 0x018, 0x33C
CMD_LENGTH, QUEUE_CAP = 8, 50
SENDQ_POS = L_SENDQ + CMD_LENGTH * QUEUE_CAP * 2
RECVQ_POS = L_RECVQ + 4 * CMD_LENGTH * QUEUE_CAP * 2

T_CLUB = 6
CLUB_STATUS, CLUB_DATA, CLUB_ENTER = 1, 2, 4
ST_HANDSHAKE_RX, ST_CONNECTED = 0xFF03, 0xFF05
CAPS_COPPIE, CAPS_DECISO = 0x0002, 0x8000
MARKER = 0xC0B1
EMPTY, DOWN, UP = 0x11, 0x12, 0x13
FPS_GBA = 59.7275
PEER_SITO, PEER_LUA = 431, 435


class Mover:
    def __init__(self):
        self.frozen = 0
        self.passi = 0

    def frame(self, key):
        if self.frozen:
            self.frozen -= 1
            return
        if key in (DOWN, UP):
            self.passi += 1
            self.frozen = 15   # ciclo di 16: TryAdvanceScript gira gia' nel frame del passo


class Memoria:
    def __init__(self):
        self.m = {}

    def r8(self, a): return self.m.get(a, 0)
    def w8(self, a, v): self.m[a] = v & 0xFF
    def r16(self, a): return self.r8(a) | (self.r8(a + 1) << 8)
    def w16(self, a, v): self.w8(a, v); self.w8(a + 1, v >> 8)
    def r32(self, a): return self.r16(a) | (self.r16(a + 2) << 16)
    def w32(self, a, v): self.w16(a, v & 0xFFFF); self.w16(a + 2, (v >> 16) & 0xFFFF)


def tasti(n, schema):
    out = [EMPTY] * n
    for a, b, k in schema:
        for f in range(a, min(b, n)):
            out[f] = k
    return out


def blocco(parole):
    b = bytearray(64)
    for i, w in enumerate(parole):
        struct.pack_into("<H", b, 2 * i, w)
    return bytes(b)


class Partita:
    """Una corsa: il Lua vero in mezzo, tutto il resto finto."""

    def __init__(self, seme, caps=True, jitter_ms=30, lat_ms=16, fps_mg=60.0,
                 secondi=30, riapri_al_s=None):
        self.rnd = random.Random(seme)
        self.caps, self.jitter, self.lat = caps, jitter_ms, lat_ms
        self.fps_mg, self.secondi, self.riapri_al = fps_mg, secondi, riapri_al_s
        self.mem = Memoria()
        self.vblank = 1000
        self.in_volo = []          # (t_arrivo, tipo, dati) verso il Lua
        self.verso_pico = []       # (t_arrivo, cmd) comandi di mGBA
        self.fifo = []
        self.log = []
        L = lupa.LuaRuntime(unpack_returned_tuples=True, encoding=None)
        self.L = L
        mem = self.mem

        def r8(_, a): return mem.r8(a)
        def r16(_, a): return mem.r16(a)
        def r32(_, a): return self.vblank if a == VBLANK else mem.r32(a)
        def w8(_, a, v): mem.w8(a, v)
        def w16(_, a, v): mem.w16(a, v)
        def w32(_, a, v): mem.w32(a, v)
        g = L.globals()
        g[b"emu"] = L.table_from({b"read8": r8, b"read16": r16, b"read32": r32,
                                  b"write8": w8, b"write16": w16, b"write32": w32})
        g[b"console"] = L.table_from({b"log": lambda *a: self.log.append(a[-1]),
                                      b"warn": lambda *a: None,
                                      b"error": lambda *a: self.log.append(a[-1])})
        L.execute(open(CLUB, "rb").read())
        self.club = g[b"ClubLua"]
        self.club[b"collega"](lambda t, corpo: self._dal_lua(t, corpo),
                          lambda: PEER_LUA, lambda: True)

    # --- il Lua manda: i blocchi (comandi di mGBA) vanno verso il Pico -------
    def _dal_lua(self, tipo, corpo):
        corpo = bytes(corpo, "latin-1") if isinstance(corpo, str) else bytes(corpo)
        if tipo == T_CLUB and corpo[0] == CLUB_DATA:
            cmd = struct.unpack_from("<8H", corpo, 9)
            if any(cmd):
                self.verso_pico.append((self.t_mg + self._ritardo(), cmd))

    def _ritardo(self):
        return self.lat + self.rnd.uniform(0, self.jitter)

    def _al_lua(self, t, corpo):
        self.in_volo.append((t + self._ritardo(), corpo))

    def _stato_sito(self, t, sseq, status):
        caps = (CAPS_DECISO | CAPS_COPPIE) if self.caps else 0
        corpo = struct.pack("<BIHHHIH", CLUB_STATUS, 0xABCD, sseq, status, 4, 0x57454221, caps) \
            if self.caps else struct.pack("<BIHHHI", CLUB_STATUS, 0xABCD, sseq, status, 4, 0x57454221)
        self._al_lua(t, corpo)

    def corri(self):
        n_gba = int(self.secondi * FPS_GBA)
        n_mg = int(self.secondi * self.fps_mg)
        avvio_gba = 60                              # il GBA si aggancia a 1 s
        k_gba = tasti(n_gba, [(avvio_gba + 300, avvio_gba + 460, DOWN),
                              (avvio_gba + 600, avvio_gba + 603, UP),
                              (avvio_gba + 620, avvio_gba + 623, UP),
                              (avvio_gba + 900, avvio_gba + 1060, UP)])
        k_mg = tasti(n_mg, [(420, 590, UP), (820, 921, DOWN), (1100, 1103, DOWN),
                            (1250, 1410, DOWN)])
        # mGBA al bancone: link in handshake, callback acceso.
        self.mem.w8(ADDR_gLink + L_STATE, 2)
        self.mem.w32(ADDR_gLinkCallback, 1)
        self._al_lua(0, struct.pack("<BI", CLUB_ENTER, 0xABCD))
        for s in range(3):
            self._stato_sito(0, s, ST_HANDSHAKE_RX)
        self._stato_sito(300, 3, ST_CONNECTED)

        gba_g, gba_m = Mover(), Mover()
        mg_g, mg_m = Mover(), Mover()
        seq = 0
        contatore = 0
        f_gba = 0
        riaperto = False
        for f in range(n_mg):
            self.t_mg = f / self.fps_mg * 1000
            # --- il GBA e il Pico fino a questo istante ---------------------
            while f_gba < n_gba and f_gba / FPS_GBA * 1000 <= self.t_mg:
                t = f_gba / FPS_GBA * 1000
                while self.verso_pico and self.verso_pico[0][0] <= t:
                    self.verso_pico.sort()
                    self.fifo.append(self.verso_pico.pop(0)[1])
                if f_gba >= avvio_gba:
                    if (self.riapri_al is not None and not riaperto
                            and t >= self.riapri_al * 1000):
                        # La riapertura: il firmware purga la coda e riparte
                        # col contatore (link.cpp / usbLinkCommand init).
                        riaperto = True
                        self.fifo = []
                        contatore = 0
                    dal_pico = self.fifo.pop(0) if self.fifo else (0,) * 8
                    mio = (0xCAFE, k_gba[f_gba], 0, 0, 0, 0, 0, 0)
                    gba_g.frame(k_gba[f_gba])
                    gba_m.frame(dal_pico[1] if dal_pico[0] == 0xCAFE else 0)
                    b = blocco(list(mio) + list(dal_pico) + [MARKER, contatore & 0xFFFF])
                    contatore += 1
                    self._al_lua(t, struct.pack("<BII", CLUB_DATA, 0xABCD, seq) + b)
                    seq += 1
                f_gba += 1
            # --- consegne dalla rete al Lua ----------------------------------
            self.in_volo.sort(key=lambda x: x[0])
            while self.in_volo and self.in_volo[0][0] <= self.t_mg:
                corpo = self.in_volo.pop(0)[1]
                self.club[b"riceviCorpo"](corpo, PEER_SITO)
            # --- il gioco di mGBA: una coppia dalla coda di ricezione --------
            self.vblank += 1
            if (self.riapri_al is not None and riaperto and not getattr(self, "_mg_riap", False)):
                # anche il gioco di mGBA riapre: link chiuso un attimo, poi su
                self._mg_riap = True
                self.mem.w8(ADDR_gLink + L_STATE, 2)
                self.mem.w32(ADDR_gLinkCallback, 0)
                self.club[b"tick"]()
                self.mem.w32(ADDR_gLinkCallback, 1)
            pos = self.mem.r8(ADDR_gLink + RECVQ_POS)
            cnt = self.mem.r8(ADDR_gLink + RECVQ_POS + 1)
            chiavi = [0, 0]
            if cnt:
                base = ADDR_gLink + L_RECVQ
                for p in (0, 1):
                    c0 = self.mem.r16(base + ((p * CMD_LENGTH + 0) * QUEUE_CAP + pos) * 2)
                    c1 = self.mem.r16(base + ((p * CMD_LENGTH + 1) * QUEUE_CAP + pos) * 2)
                    chiavi[p] = c1 if c0 == 0xCAFE else 0
                self.mem.w8(ADDR_gLink + RECVQ_POS, (pos + 1) % QUEUE_CAP)
                self.mem.w8(ADDR_gLink + RECVQ_POS + 1, cnt - 1)
            if self.mem.r8(ADDR_gLink + L_STATE) == 4:
                # chi e' chi: CLUB_IO_ID lo scrive il Lua in L_LOCALID
                io = self.mem.r8(ADDR_gLink + 0x002)
                mg_m.frame(chiavi[io])
                mg_g.frame(chiavi[1 - io])
                # il gioco accoda il SUO tasto di questo frame
                spos = self.mem.r8(ADDR_gLink + SENDQ_POS)
                scnt = self.mem.r8(ADDR_gLink + SENDQ_POS + 1)
                idx = (spos + scnt) % QUEUE_CAP
                parole = (0xCAFE, k_mg[f], 0, 0, 0, 0, 0, 0)
                for j, w in enumerate(parole):
                    self.mem.w16(ADDR_gLink + L_SENDQ + (j * QUEUE_CAP + idx) * 2, w)
                self.mem.w8(ADDR_gLink + SENDQ_POS + 1, scnt + 1)
            self.club[b"tick"]()
        st = self.club[b"stato"]
        return {
            "gba_vede_gba": gba_g.passi, "mgba_vede_gba": mg_g.passi,
            "mgba_vede_mgba": mg_m.passi, "gba_vede_mgba": gba_m.passi,
            "seguace": bool(st[b"coppie"]), "affamati_in_moto": st[b"affamatiInMoto"],
            "vecchie": st[b"vecchieScartate"], "compresse": st[b"compresse"],
            "ricariche": st[b"ricariche"],
            "log": self.log,
        }


@unittest.skipIf(lupa is None, "lupa non installato (pip install lupa)")
class TestSeguace(unittest.TestCase):

    def test_seguace_i_due_giochi_concordano(self):
        # mGBA alla stessa velocita', un filo piu' veloce (60 Hz: il cuscinetto
        # si consuma) e piu' lento (59 Hz: l'arretrato cresce), jitter normale
        # e alto (i picchi del log del 27/09 arrivano a 500 ms: qui 80).
        casi = [(FPS_GBA, 30), (60.0, 30), (59.0, 30), (60.0, 80)]
        for fps, jit in casi:
            for seme in range(12):
                r = Partita(seme, caps=True, fps_mg=fps, jitter_ms=jit).corri()
                self.assertTrue(r["seguace"], [x for x in r["log"] if b"modo" in x])
                self.assertGreater(r["gba_vede_gba"], 5)
                self.assertGreater(r["mgba_vede_mgba"], 5)
                self.assertEqual(r["gba_vede_gba"], r["mgba_vede_gba"], (fps, jit, seme, r))
                self.assertEqual(r["mgba_vede_mgba"], r["gba_vede_mgba"], (fps, jit, seme, r))
                self.assertEqual(r["affamati_in_moto"], 0, (fps, jit, seme))

    def test_modo_di_prima_il_difetto_si_vede(self):
        discordi = 0
        for seme in range(12):
            r = Partita(seme, caps=False).corri()
            self.assertFalse(r["seguace"])
            if (r["gba_vede_gba"] != r["mgba_vede_gba"]
                    or r["mgba_vede_mgba"] != r["gba_vede_mgba"]):
                discordi += 1
        self.assertGreater(discordi, 6, "il banco non vede piu' il difetto: non prova niente")

    def test_riapertura_a_meta(self):
        for seme in range(6):
            r = Partita(seme, caps=True, riapri_al_s=12).corri()
            self.assertTrue(r["seguace"])
            self.assertEqual(r["gba_vede_gba"], r["mgba_vede_gba"], (seme, r))
            self.assertEqual(r["mgba_vede_mgba"], r["gba_vede_mgba"], (seme, r))


if __name__ == "__main__":
    unittest.main(verbosity=2)
