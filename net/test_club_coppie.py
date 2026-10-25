#!/usr/bin/env python3
"""
test_club_coppie.py - il Cable Club in una stanza da 3-4 (2026-10-25).

Il relay porta i pacchetti del club di tutti a tutti, e fino al 2026-10-25 il
primo ENTER tirava dentro chiunque lo sentisse: con due coppie al bancone gli
scambi si incrociavano (e i Pico di chi camminava passavano in modo link).
Qui girano QUATTRO client veri (client.Bridge, stessa handle_club_net, stessa
ClubSession) in un processo solo, con un relay finto che inoltra a tutta la
stanza e un Pico finto per client che marca i propri blocchi col proprio peer.

Il criterio e' uno: OGNI device riceve blocchi SOLO dal suo partner. Accanto:
ruoli complementari in ogni coppia, e i Pico di chi non c'entra mai in modo
link.

    D:\\Progettini\\Python313\\python.exe net\\test_club_coppie.py
"""

import os
import queue
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import client as modulo_client  # noqa: E402
import club_link  # noqa: E402
from club_link import Accoppiamento  # noqa: E402
from protocol import (  # noqa: E402
    CLUB_DATA, CLUB_ENTER, CLUB_LEAVE, CLUB_REQ, CLUB_STATUS, T_CLUB,
    club_con_per, club_data, club_enter, club_leave, club_per, club_req,
    club_status, club_unpack, unpack,
)
from usb_link import (  # noqa: E402
    CMD_CONNECT_LINK, CMD_SET_MODE_MASTER, CMD_SET_MODE_SLAVE,
    CMD_START_HANDSHAKE, LINK_ST_AWAIT_MODE, LINK_ST_CONNECTED,
    LINK_ST_HANDSHAKE_RX,
)

# Il ConnectLink distanziato (0,35 s) qui farebbe solo aspettare.
club_link.CONNECT_RITARDO_S = 0.0

TAG = 0xC1      # primo byte dei blocchi del Pico finto: [TAG][peer u16][n]


class PicoFinto:
    """Il minimo di Celio che serve alla scala: AwaitMode all'ingresso,
    HandshakeRx dopo il ruolo, "collegato" dopo StartHandshake (lato master) o
    ConnectLink (lato slave); da collegato produce tre blocchi marcati."""

    def __init__(self, peer):
        self.peer = peer
        self.entrate = 0
        self.ruolo = None
        self.collegato = False
        self.ricevuti = []           # blocchi arrivati al "GBA"
        self.club_statuses = queue.Queue()
        self.club_blocks = queue.Queue()

    def club_enter(self):
        self.entrate += 1
        self.club_statuses.put(LINK_ST_AWAIT_MODE)
        return True

    def club_exit(self):
        pass

    def club_command(self, cmd, label):
        if cmd in (CMD_SET_MODE_MASTER, CMD_SET_MODE_SLAVE):
            self.ruolo = "master" if cmd == CMD_SET_MODE_MASTER else "slave"
            self.club_statuses.put(LINK_ST_HANDSHAKE_RX)
        elif cmd == CMD_START_HANDSHAKE and self.ruolo == "master":
            self._collega()
        elif cmd == CMD_CONNECT_LINK:
            self._collega()

    def _collega(self):
        if self.collegato:
            return
        self.collegato = True
        self.club_statuses.put(LINK_ST_CONNECTED)
        for n in range(3):
            b = bytearray(64)
            b[0], b[1], b[2], b[3] = TAG, self.peer & 0xFF, self.peer >> 8, n
            self.club_blocks.put(bytes(b))

    def club_send_block(self, block64):
        self.ricevuti.append(block64)
        return True

    def da_chi(self):
        return {b[1] | (b[2] << 8) for b in self.ricevuti if b[0] == TAG}


class ClientFinto(modulo_client.Bridge):
    """Un client vero senza socket: solo la parte del club."""

    def __init__(self, peer, relay, scelto=0):
        self.peer_id = peer
        self.room = 7
        self.relay = relay
        self.usb = PicoFinto(peer)
        self.club = None
        self.club_acc = Accoppiamento()
        self.club_acc.scelto = scelto
        self.club_bacheca_detta = {}
        self.club_sessions = 0
        self.club_riaggancio_dopo = 0.0
        self.club_malformati = 0
        self.club_versione_detta = True
        self.club_drop = 0
        self.gba_muto = False
        self.gba_muto_scartati = 0
        self.last_seq = {}
        self.out_seq = 0
        self.righe = []
        self.vecchio = False         # True = non mette il destinatario

    def log(self, m):
        self.righe.append(m)

    def send_club(self, body):
        if self.vecchio:
            # Un client di prima del 2026-10-25: niente destinatario.
            self.relay.manda(self, body)
            return
        self.relay.manda(self, club_con_per(body, self.club_acc.per_uscita()))


class RelayFinto:
    """Una stanza: ogni corpo a tutti gli altri, come relay.broadcast."""

    def __init__(self):
        self.client = []
        self.coda = []

    def aggiungi(self, c):
        self.client.append(c)
        for a in self.client:        # tutti si conoscono: si cammina insieme
            a.last_seq = {b.peer_id: 0 for b in self.client if b is not a}
        return c

    def manda(self, da, body):
        for c in self.client:
            if c is not da:
                self.coda.append((c, da.peer_id, body))

    def gira(self, secondi=1.0):
        fine = time.monotonic() + secondi
        while time.monotonic() < fine:
            while self.coda:
                c, peer, body = self.coda.pop(0)
                c.handle_club_net(peer, body, time.monotonic())
            for c in self.client:
                c.club_pump()
            time.sleep(0.005)


def stanza(*peer):
    r = RelayFinto()
    return r, [r.aggiungi(ClientFinto(p, r)) for p in peer]


class TestProtocollo(unittest.TestCase):

    def test_destinatario_in_coda_a_ogni_corpo(self):
        blocco = bytes(range(64))
        for corpo in (club_status(9, 1, LINK_ST_CONNECTED, caps=0),
                      club_data(9, 5, blocco), club_req(9, [1, 2, 3]),
                      club_enter(9), club_leave(9)):
            con = club_con_per(corpo, 51000)
            self.assertEqual(club_per(con), 51000)
            self.assertIsNone(club_per(corpo))
            # chi e' vecchio legge lo stesso identico contenuto
            self.assertEqual(club_unpack(con), club_unpack(corpo))

    def test_stato_senza_capacita_le_prende_a_zero(self):
        corpo = club_status(9, 1, LINK_ST_CONNECTED)        # 15 byte
        con = club_con_per(corpo, 3)
        self.assertEqual(len(con), 19)
        self.assertEqual(club_per(con), 3)
        self.assertEqual(club_unpack(con)[2][4], 0)          # caps


class TestAccoppiamento(unittest.TestCase):

    def test_in_due_si_entra_con_l_unico_altro(self):
        a = Accoppiamento()
        self.assertTrue(a.apre(1, 2, None, {2}))
        self.assertTrue(a.apre(1, 2, 0, {2}))

    def test_in_quattro_senza_scelta_non_si_entra(self):
        a = Accoppiamento()
        self.assertFalse(a.apre(1, 2, 0, {2, 3, 4}))
        self.assertFalse(a.apre(1, 2, 3, {2, 3, 4}))
        self.assertTrue(a.apre(1, 2, 1, {2, 3, 4}))         # mi ha scelto

    def test_la_scelta_vince_su_chi_mi_cerca(self):
        a = Accoppiamento()
        a.scelto = 3
        self.assertFalse(a.apre(1, 2, 1, {2, 3, 4}))
        self.assertTrue(a.apre(1, 3, 0, {2, 3, 4}))

    def test_scelta_su_chi_non_c_e_non_conta(self):
        a = Accoppiamento()
        a.scelto = 9
        self.assertTrue(a.apre(1, 2, 0, {2}))                # torna il caso a due

    def test_a_partner_noto_passa_solo_lui(self):
        a = Accoppiamento()
        a.partner = 2
        self.assertFalse(a.accetta(1, 2, 1, {2, 3}))
        self.assertFalse(a.accetta(1, 2, 0, {2, 3}))
        self.assertIsNone(a.accetta(1, 3, 1, {2, 3}))
        self.assertIsNone(a.accetta(1, 2, 3, {2, 3}))        # lui parla con un altro
        self.assertEqual(a.scartati, 2)


class TestQuattroClient(unittest.TestCase):

    def assertCoppia(self, x, y):
        self.assertEqual(x.club_acc.partner, y.peer_id, x.righe[-15:])
        self.assertEqual(y.club_acc.partner, x.peer_id, y.righe[-15:])
        self.assertEqual({x.usb.ruolo, y.usb.ruolo}, {"master", "slave"})
        self.assertTrue(x.usb.collegato and y.usb.collegato)
        self.assertEqual(x.usb.da_chi(), {y.peer_id})
        self.assertEqual(y.usb.da_chi(), {x.peer_id})
        self.assertEqual(len(x.usb.ricevuti), 3)
        self.assertEqual(len(y.usb.ricevuti), 3)

    def test_in_due_come_prima(self):
        r, (a, b) = stanza(11, 22)
        a.club_start("il TUO GBA", dal_gba=True)
        r.gira()
        self.assertCoppia(a, b)

    def test_in_due_con_un_client_vecchio(self):
        r, (a, b) = stanza(11, 22)
        b.vecchio = True
        a.club_start("il TUO GBA", dal_gba=True)
        r.gira()
        self.assertCoppia(a, b)

    def test_due_coppie_insieme(self):
        """Il caso della domanda: tu con Tizio, gli altri due fra loro, nello
        stesso momento. Sceglie uno per coppia; l'altro entra da solo."""
        r, (a, b, c, d) = stanza(11, 22, 33, 44)
        a.club_acc.scelto = 22
        c.club_acc.scelto = 44
        a.club_start("il TUO GBA", dal_gba=True)
        c.club_start("il TUO GBA", dal_gba=True)
        r.gira()
        self.assertCoppia(a, b)
        self.assertCoppia(c, d)
        for x in (a, b, c, d):
            self.assertEqual(x.usb.entrate, 1)

    def test_in_quattro_senza_scelta_nessuno_viene_tirato_dentro(self):
        r, (a, b, c, d) = stanza(11, 22, 33, 44)
        a.club_start("il TUO GBA", dal_gba=True)
        r.gira(0.5)
        for x in (b, c, d):
            self.assertEqual(x.usb.entrate, 0, "il Pico di %d e' entrato" % x.peer_id)
        self.assertIsNone(a.club_acc.partner)
        self.assertIsNone(a.usb.ruolo)               # nessun ruolo a caso
        self.assertTrue(any("CON CHI?" in riga for riga in a.righe))
        # Poi il 33 sceglie l'11 dal sito: entra lui, e la coppia parte.
        c.club_con(11)
        r.gira()
        self.assertCoppia(a, c)
        self.assertEqual(b.usb.entrate, 0)
        self.assertEqual(d.usb.entrate, 0)

    def test_partner_occupato_non_si_ruba(self):
        r, (a, b, c, d) = stanza(11, 22, 33, 44)
        a.club_acc.scelto = 22
        a.club_start("il TUO GBA", dal_gba=True)
        r.gira()
        self.assertCoppia(a, b)
        # Il 33 arriva al bancone e sceglie l'11, che e' gia' con il 22.
        c.club_acc.scelto = 11
        c.club_start("il TUO GBA", dal_gba=True)
        r.gira(0.5)
        self.assertEqual(a.usb.da_chi(), {22})
        self.assertEqual(c.usb.ricevuti, [])
        self.assertGreater(a.club_acc.scartati, 0)
        self.assertEqual(d.usb.entrate, 0)

    def test_il_leave_libera_la_bacheca(self):
        r, (a, b, c) = stanza(11, 22, 33)
        a.club_acc.scelto = 22
        a.club_start("il TUO GBA", dal_gba=True)
        r.gira(0.3)
        self.assertEqual(c.club_acc.al_club(time.monotonic()).get(11), 22)
        a.club.finita = True
        a.club_pump()
        r.gira(0.1)
        self.assertNotIn(11, c.club_acc.al_club(time.monotonic()))


if __name__ == "__main__":
    unittest.main(verbosity=2)
