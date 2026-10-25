#!/usr/bin/env python3
"""
test_club_lua.py - il partner del club, nel Lua, muore con la sessione
(2026-08-28).

IL DIFETTO CHE CHIUDE
---------------------
`stato.partnerPeer` in mgba/club_lua.lua veniva scritto da OGNI T_CLUB in
arrivo - anche a sessione spenta, la riga stava prima di ogni ramo - e non
veniva MAI rimesso a nil. Bastava che un pacchetto dell'amico fosse passato
una volta (una sessione di ieri, o lui al bancone mentre noi camminavamo)
perche' da li' in avanti il gate dell'attesa

    if stato.partnerPeer or aspettato > ATTESA_MAX_FRAME then collega()

si aprisse subito: `collega()` a mezzo secondo dall'ingresso, ruolo deciso
contro un peer che non c'e', e soprattutto il ri-annuncio dell'ENTER SPENTO -
quel ramo vive solo finche' non si e' collegati. Chi arrivava al bancone per
primo smetteva di annunciarsi, e l'amico che arrivava dopo non lo trovava mai.

COSA PROVA. Ritaglia dal file VERO `annuncia()` e `chiudi()` e le esegue con
lupa, con un'impalcatura al posto di mGBA. Se qualcuno domani togliesse
l'azzeramento, qui si rompe.

Quello che NON prova (serve mGBA, ed e' la procedura J-bis in NOTES): il
ri-annuncio periodico vero, il gate dentro `tick`, e la scrittura condizionata
in `riceviCorpo` - quest'ultima ha pero' un controllo strutturale qui sotto.

    D:\\Progettini\\Python313\\python.exe tools\\test_club_lua.py
"""

import os
import re
import sys
import unittest

QUI = os.path.dirname(os.path.abspath(__file__))
RADICE = os.path.dirname(QUI)
CLUB = os.path.join(RADICE, "mgba", "club_lua.lua")

IMPALCATURA = """
    console = { log = function() end, error = function() end, warn = function() end }
    emu = {
      read32 = function() return 1000 end,
      write8 = function() end,
      write16 = function() end,
    }
    ADDR_gLinkVSyncDis = 0
    REG_RCNT = 0
    T_CLUB = 6
    CLUB_STATUS, CLUB_DATA, CLUB_REQ, CLUB_ENTER, CLUB_LEAVE = 1, 2, 3, 4, 5
    ST_HANDSHAKE_RX, ST_CLOSED = 3, 9
    CLUB_IO_ID, CLUB_PARTNER_ID = 0, 0
    inviati = {}
    function manda(t, corpo) inviati[#inviati+1] = corpo end
    function mandaStato(s) end
    stato = {
      attivo = false, collegato = false, sessioni = 0, epoca = 0,
      seqTx = 0, attesoRx = 0, sseq = 0,
      storia = {}, buffer = {}, codaPartner = {},
      master = false, txSessione = 0, rxSessione = 0,
      epocaPartner = nil, apertoDa = 0, exitRoom = false,
      inRiapertura = false, congedo = false,
      cafeCodice = 0, cafeFrame = 0,
      tx = 0, rx = 0, dup = 0, fuoriOrdine = 0, richiesti = 0,
      partnerPeer = nil, partnerLua = nil, riannunciEnter = 0,
      scelto = 0, atteso = nil, altrui = 0,
    }
    -- con chi (2026-10-25): io sono il peer 11; `cammina` = chi manda eventi
    BACHECA_FRAME = 600
    bacheca = {}
    io_peer = 11
    cammina = {}
    function chiPeer() return io_peer end
    function chiCammina() return cammina end
"""


def ritaglia(sorgente, nome):
    m = re.search(r"^local function %s\(.*?^end$" % re.escape(nome),
                  sorgente, re.S | re.M)
    if not m:
        raise AssertionError(
            "funzione %s non trovata in club_lua.lua (rinominata? il test va "
            "aggiornato con lei)" % nome)
    return m.group(0)


class TestPartnerDellaSessione(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import lupa
        except ImportError:
            raise unittest.SkipTest("lupa non installato (pip install lupa)")
        with open(CLUB, encoding="utf-8") as f:
            cls.src = f.read()
        cls.lupa = lupa

    def nuovo(self):
        lua = self.lupa.LuaRuntime(unpack_returned_tuples=True)
        lua.execute(IMPALCATURA)
        for nome in ("adesso", "presenti", "sceltoValido", "accetta",
                     "lungo", "perDi", "mandaClub", "annuncia", "chiudi"):
            lua.execute(ritaglia(self.src, nome)
                        .replace("local function", "function", 1))
        return lua

    def test_annuncia_dimentica_il_partner_di_ieri(self):
        lua = self.nuovo()
        lua.execute("stato.partnerPeer = 47001; stato.partnerLua = true")
        lua.execute("annuncia()")
        self.assertIsNone(lua.eval("stato.partnerPeer"),
                          "la sessione nuova aspetterebbe un peer di ieri: e' "
                          "il difetto per cui chi arriva primo non si annuncia piu'")
        self.assertIsNone(lua.eval("stato.partnerLua"))

    def test_annuncia_apre_la_sessione(self):
        lua = self.nuovo()
        lua.execute("annuncia()")
        self.assertTrue(lua.eval("stato.attivo"))
        self.assertFalse(lua.eval("stato.collegato"))
        # e l'ENTER e' partito: e' l'annuncio all'amico
        self.assertGreaterEqual(lua.eval("#inviati"), 1)

    def test_chiudi_dimentica_il_partner(self):
        lua = self.nuovo()
        lua.execute("annuncia(); stato.partnerPeer = 2; stato.partnerLua = true")
        lua.execute("chiudi('prova')")
        self.assertIsNone(lua.eval("stato.partnerPeer"))
        self.assertIsNone(lua.eval("stato.partnerLua"))
        self.assertFalse(lua.eval("stato.attivo"))

    def test_il_contatore_dei_riannunci_riparte_da_zero(self):
        lua = self.nuovo()
        lua.execute("stato.riannunciEnter = 7")
        lua.execute("annuncia()")
        self.assertEqual(lua.eval("stato.riannunciEnter"), 0,
                         "il contatore deve valere PER SESSIONE, o non si "
                         "capisce piu' quale sessione si e' annunciata quanto")

    def test_il_partner_si_registra_solo_a_sessione_viva(self):
        """Controllo STRUTTURALE (riceviCorpo ha troppe dipendenze per girare
        qui): partnerPeer si scrive SOLO in accetta(), e riceviCorpo chiama
        accetta() solo a sessione viva. Fino al 2026-10-25 riceviCorpo lo
        riscriveva a ogni pacchetto: in 3-4 il partner saltava di peer in peer."""
        scritture = re.findall(r"stato\.partnerPeer\s*=\s*(?!=)([^\n]+)", self.src)
        vere = [w.strip() for w in scritture if not w.strip().startswith("nil")]
        self.assertEqual(vere, ["mitt return true end"],
                         "partnerPeer scritto fuori da accetta(): %r" % vere)
        corpo = ritaglia(self.src.replace("function Club.riceviCorpo", "local function riceviCorpo"),
                         "riceviCorpo")
        self.assertRegex(corpo, r"if stato\.attivo then\s+if accetta\(",
                         "accetta() va chiamata solo a sessione viva: un T_CLUB in "
                         "volo pre-armerebbe il gate della sessione DOPO (2026-08-28)")

    # --- con chi, in una stanza da 3-4 (2026-10-25) -----------------------

    def test_in_due_il_primo_che_parla_e_il_partner(self):
        lua = self.nuovo()
        lua.execute("cammina = {[22] = true}; annuncia()")
        self.assertEqual(lua.eval("accetta(22, nil)"), True)
        self.assertEqual(lua.eval("stato.partnerPeer"), 22)
        self.assertIsNone(lua.eval("accetta(33, nil)"))
        self.assertEqual(lua.eval("accetta(22, 0)"), False)

    def test_in_quattro_senza_scelta_passa_solo_chi_ci_sceglie(self):
        lua = self.nuovo()
        lua.execute("cammina = {[22] = true, [33] = true, [44] = true}; annuncia()")
        self.assertIsNone(lua.eval("accetta(22, 0)"))
        self.assertIsNone(lua.eval("accetta(22, 33)"))
        self.assertIsNone(lua.eval("stato.partnerPeer"))
        self.assertEqual(lua.eval("accetta(44, 11)"), True)
        self.assertEqual(lua.eval("stato.partnerPeer"), 44)
        self.assertIsNone(lua.eval("accetta(44, 33)"), "il partner che parla con un altro")

    def test_annuncia_prende_chi_ci_aspetta_ma_non_lo_collega(self):
        lua = self.nuovo()
        lua.execute("cammina = {[22] = true, [33] = true}; "
                    "bacheca[22] = {per = 11, quando = 1000}; annuncia()")
        self.assertEqual(lua.eval("stato.atteso"), 22)
        self.assertIsNone(lua.eval("stato.partnerPeer"),
                          "partnerPeer apre il link: deve nascere da un pacchetto vero")
        self.assertIsNone(lua.eval("accetta(33, 0)"))
        self.assertEqual(lua.eval("accetta(22, 0)"), True)

    def test_la_scelta_vince(self):
        lua = self.nuovo()
        lua.execute("cammina = {[22] = true, [33] = true, [44] = true}; "
                    "bacheca[22] = {per = 11, quando = 1000}; stato.scelto = 44; annuncia()")
        self.assertEqual(lua.eval("stato.atteso"), 44)

    def test_il_destinatario_viaggia_in_coda(self):
        lua = self.nuovo()
        lua.execute("cammina = {[22] = true, [33] = true}; stato.scelto = 33; annuncia()")
        self.assertEqual(lua.eval("#inviati[1]"), 7)          # ENTER: 5 + per
        self.assertEqual(lua.eval("(string.unpack('<I2', inviati[1], 6))"), 33)
        self.assertEqual(lua.eval("perDi(inviati[1])"), 33)
        self.assertIsNone(lua.eval("perDi(string.pack('<BI4', 4, 9))"))

    def test_chiudi_dimentica_anche_l_atteso(self):
        lua = self.nuovo()
        lua.execute("cammina = {[22] = true, [33] = true}; stato.scelto = 33; annuncia()")
        lua.execute("chiudi('prova')")
        self.assertIsNone(lua.eval("stato.atteso"))
        # il LEAVE e' partito PRIMA di dimenticare: dice ancora a chi era rivolto
        self.assertEqual(lua.eval("perDi(inviati[#inviati])"), 33)


if __name__ == "__main__":
    unittest.main(verbosity=2)
