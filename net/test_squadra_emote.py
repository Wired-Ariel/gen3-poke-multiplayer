#!/usr/bin/env python3
"""test_squadra_emote.py - le emote e la squadra nella scheda (2026-10-16), lato PC.

Senza rete e senza processi: protocol.py e un client.py finto.

  1. chat: un'emote e' un messaggio con "emote" 0/1/2 e il simbolo come testo;
     fuori range non e' un'emote; il corpo e' quello che legge web/js/chat.js
     (lo stesso testo e' un caso di web/bridge_test.html).
  2. client.handle_chat: l'emote di un amico va al GBA come EV_EMOTE timbrato
     col SUO slot, una volta sola anche se il relay duplica; senza avatar si
     conta e basta.
  3. la squadra: card_put_chunk + party_from_card rileggono specie, livello,
     cromatico, esausto e uovo dai pezzi EV_CARD (fuori ordine), una scheda
     di un payload vecchio (zeri) non ha squadra, una specie oltre l'uovo e'
     spazzatura.
  4. client._pezzo_scheda: amico e "io", annuncio nel registro solo quando la
     squadra CAMBIA, e un pezzo di scheda non cancella la posizione di un
     amico appena arrivato (il difetto trovato da bridge_test il 2026-10-16).

Uso: python net/test_squadra_emote.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from protocol import (  # noqa: E402
    CHAT_EMOTE, EV_CARD, EV_EMOTE, EV_PARTY, EVENT_SIZE, PARTY_REC, card_put_chunk,
    chat_pack, chat_unpack, describe_event, party_details, party_details_put_chunk,
    party_from_card, squadra_in_uscita,
)
import client as modulo_client  # noqa: E402

KCARD = (2, 6, 7, 8, 9, 10, 11)


def scheda(squadra):
    """96 byte di scheda col layout CARD_PARTY_* del payload."""
    b = bytearray(96)
    for k in range(0x44):
        b[k] = (k * 7) & 0xFF                    # il resto della scheda: rumore
    shiny = ko = 0
    for i, m in enumerate(squadra):
        sp, lv = m[0], m[1]
        b[0x54 + i * 2], b[0x55 + i * 2], b[0x44 + i] = sp & 0xFF, sp >> 8, lv
        if len(m) > 2 and m[2]:
            shiny |= 1 << i
        if len(m) > 3 and m[3]:
            ko |= 1 << i
    b[0x4A], b[0x4B] = shiny, ko
    return b


def pezzo(card, idx):
    """Un EV_CARD come lo emette EmitCardChunk."""
    e = bytearray(EVENT_SIZE)
    e[0], e[1] = EV_CARD, idx
    for k, off in enumerate(KCARD):
        if idx * 7 + k < 96:
            e[off] = card[idx * 7 + k]
    return bytes(e)


class Finto(modulo_client.Bridge):
    def __init__(self):        # niente socket: solo handle_chat, deliver, schede
        self.peer_id = 5
        self.room = 9
        self.chat, self.chat_visti, self.chat_nomi = [], {}, {}
        self.chat_ricevuti = self.chat_doppi = self.chat_illeggibili = 0
        self.pos_sporche = False
        self.righe, self.al_gba = [], []
        self.peer_slots = {22: 0, 33: 1}
        self.schede = {}
        self.emote_consegnate = self.emote_senza_avatar = 0
        self.pos_amici = {}

    def log(self, m):
        self.righe.append(m)

    def deliver(self, event, slot=0):
        if slot:
            event = bytes((event[0] | (slot << 4),)) + event[1:]
        self.al_gba.append(event)


def main():
    # --- 1. il corpo --------------------------------------------------------
    m = chat_unpack(chat_pack({"id": "e1", "nome": "Lain", "testo": "", "ts": 9, "emote": 2}))
    assert m["emote"] == 2 and m["testo"] == CHAT_EMOTE[2], m
    assert chat_pack({"id": "e2", "nome": "x", "testo": "", "ts": 9, "emote": 3}) is None
    assert "emote" not in chat_unpack(json.dumps({"id": "e3", "testo": "ciao", "ts": 1, "emote": True}).encode())
    corpo = chat_pack({"id": "p1", "nome": "Marta", "testo": "", "ts": 1700000000000, "emote": 0})
    atteso = '{"id":"p1","nome":"Marta","testo":"❗","ts":1700000000000,"emote":0}'
    assert corpo.decode("utf-8") == atteso, corpo
    print("PASSO 1: l'emote nel corpo della chat, lo stesso testo che legge chat.js")

    # --- 2. dalla chat al GBA ----------------------------------------------
    f = Finto()
    cuore = chat_pack({"id": "c1", "nome": "Marta", "testo": "", "ts": 5, "emote": 2})
    f.handle_chat(33, cuore)
    f.handle_chat(33, cuore)                                    # il relay duplica
    f.handle_chat(44, chat_pack({"id": "c2", "nome": "Sara", "testo": "", "ts": 6, "emote": 0}))
    f.handle_chat(22, chat_pack({"id": "c3", "nome": "Gio", "testo": "solo testo", "ts": 7}))
    assert f.al_gba == [bytes((EV_EMOTE | (1 << 4), 2)) + bytes(EVENT_SIZE - 2)], f.al_gba
    assert f.emote_consegnate == 1 and f.emote_senza_avatar == 1
    assert describe_event(bytes((EV_EMOTE, 0x82)) + bytes(10)).endswith("EMOTE cuore (mia)")
    print("PASSO 2: emote al GBA col suo slot, una volta sola; senza avatar contata")

    # --- 3. la squadra dai pezzi --------------------------------------------
    sua = scheda([(280, 5), (412, 0), (277, 32, 1, 1)])
    card, pezzi = bytearray(96), 0
    for idx in (13, 12, 0, 10, 9):
        pezzi |= card_put_chunk(card, pezzo(sua, idx))
    assert party_from_card(card) == [
        {"specie": 280, "lv": 5, "cromatico": False, "ko": False, "uovo": False},
        {"specie": 412, "lv": 0, "cromatico": False, "ko": False, "uovo": True},
        {"specie": 277, "lv": 32, "cromatico": True, "ko": True, "uovo": False}], party_from_card(card)
    assert party_from_card(bytearray(96)) is None
    assert party_from_card(scheda([(280, 5), (999, 9)])) is None
    assert card_put_chunk(card, bytes((EV_CARD, 14)) + bytes(10)) == 0
    print("PASSO 3: specie, livello, cromatico, esausto e uovo dai pezzi; vecchio e spazzatura = niente")

    # --- 4. nel client --------------------------------------------------------
    f = Finto()
    for idx in (9, 10, 12, 13):
        f._pezzo_scheda(22, pezzo(scheda([(300, 12)]), idx))
    for idx in (9, 10, 12, 13):                                 # il giro dopo: uguale
        f._pezzo_scheda(22, pezzo(scheda([(300, 12)]), idx))
    for idx in (9, 10, 12, 13):
        f._pezzo_scheda("io", pezzo(scheda([(281, 16), (277, 7)]), idx))
    annunci = [r for r in f.righe if r.startswith("[squadra]")]
    assert annunci == ["[squadra] amico 22: #300 lv12", "[squadra] la tua: #281 lv16, #277 lv7"], annunci
    assert f.schede["io"][2][1]["specie"] == 277
    # un pezzo di scheda prima di qualunque posizione non scrive un amico "None"
    f.slot_for = lambda peer: None
    f.no_heal = False
    f.stato_amici = {}
    f.heal_and_deliver(77, pezzo(scheda([(1, 1)]), 0))
    assert 77 not in f.pos_amici, f.pos_amici
    print("PASSO 4: squadre nel client, annunciate solo quando cambiano; nessun amico None")

    # --- 5. i dettagli (EV_PARTY) ---------------------------------------------
    rec = bytearray(PARTY_REC)
    rec[0:4] = b"\xC5\xDD\xEB\xFF"
    rec[10], rec[11] = 39, 0x08
    rec[12:18] = (87).to_bytes(2, "little") + (120).to_bytes(2, "little") + (13).to_bytes(2, "little")
    for i, mossa in enumerate((57, 89, 0, 354)):
        rec[18 + i * 2:20 + i * 2] = mossa.to_bytes(2, "little")
    rec[26], rec[27] = 3, 0xFE

    def pezzi_party(mon, r):
        out = []
        for q in range(4):
            e = bytearray(EVENT_SIZE)
            e[0], e[1] = EV_PARTY, mon * 4 + q
            for k, off in enumerate(KCARD):
                e[off] = r[q * 7 + k]
            out.append(bytes(e))
        return out

    store, bits = bytearray(6 * PARTY_REC), 0
    for e in pezzi_party(2, rec):
        bits |= party_details_put_chunk(store, e)
    d = party_details(store[2 * PARTY_REC:3 * PARTY_REC])
    assert bits == 0xF << 8, hex(bits)
    assert (d["lv"], d["stato"], d["ps"], d["psMax"], d["strumento"], d["mosse"], d["natura"], d["sesso"]) == \
        (39, "veleno", 87, 120, 13, [57, 89, 0, 354], 3, "f"), d
    # nel client: dall'amico si leggono e NON vanno al GBA
    f = Finto()
    f.slot_for = lambda peer: 0
    f.no_heal, f.stato_amici, f.dettagli = False, {}, {}
    for e in pezzi_party(2, rec):
        f.heal_and_deliver(22, e)
    assert f.al_gba == [], "i dettagli non devono arrivare al GBA"
    assert f.dettagli[22][2][2]["psMax"] == 120
    assert sum(1 for r in f.righe if r.startswith("[squadra] amico 22, Pokemon 3: lv39 PS 87/120")) == 1
    print("PASSO 5: dettagli ricomposti dai 4 pezzi, letti nel client, mai consegnati al GBA")

    # --- 6. la privacy in uscita --------------------------------------------------
    pezzo12 = bytearray(EVENT_SIZE)
    pezzo12[0], pezzo12[1] = EV_CARD, 12
    for off in KCARD:
        pezzo12[off] = 0x55
    pezzo3 = bytearray(EVENT_SIZE)
    pezzo3[0], pezzo3[1], pezzo3[2] = EV_CARD, 3, 0x41
    party = pezzi_party(0, rec)[0]
    assert squadra_in_uscita(bytes(pezzo12), "tutta") == bytes(pezzo12)
    assert squadra_in_uscita(party, "tutta") == party
    assert squadra_in_uscita(party, "base") is None and squadra_in_uscita(party, "niente") is None
    assert squadra_in_uscita(bytes(pezzo12), "base") == bytes(pezzo12)
    vuoto = squadra_in_uscita(bytes(pezzo12), "niente")
    assert all(vuoto[o] == 0 for o in KCARD) and vuoto[:2] == bytes(pezzo12[:2]), vuoto
    assert squadra_in_uscita(bytes(pezzo3), "niente") == bytes(pezzo3), "il pezzo 3 non contiene la squadra"
    print("PASSO 6: privacy tutta/base/niente sui pezzi in uscita")

    print("REGRESSIONE SQUADRA ED EMOTE: PASSATA")
    return 0


if __name__ == "__main__":
    sys.exit(main())
