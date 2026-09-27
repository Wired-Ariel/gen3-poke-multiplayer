"""sim_saletta.py - i passi nella saletta del Cable Club, GBA fisico <-> mGBA (2026-09-27).

PERCHE'. Dal campo: nella saletta, 10 passi tenuti sul GBA diventano ~la meta' in
mGBA, e il personaggio di mGBA sul GBA fa PIU' passi del dovuto. Prima di
toccare firmware, sito e Lua si simula il meccanismo, come per sim_remoto.py.

IL MODELLO (dalla decomp, overworld.c):
- ogni frame il gioco legge UNA coppia di comandi (uno per giocatore) dalla coda
  di ricezione del link (LinkMain1 -> ProcessRecvCmds -> gLinkPartnersHeldKeys);
  senza coppia, i tasti di quel frame sono 0;
- CB1_OverworldLink gira OGNI frame: un tasto direzione con il personaggio libero
  fa partire il passo (FacingHandler_DpadMovement, directionSequenceIndex = 16);
  poi il personaggio e' bloccato e il conto scende di 1 a OGNI frame, con o
  senza tasti (MovementEventModeCB_Ignored -> TryAdvanceScript). Un tasto tenuto
  fa quindi un passo ogni 17 frame.

LE CATENE:
- GBA fisico (master): un trasferimento per frame. Il Pico risponde col prossimo
  comando di mGBA che ha in coda (FIFO, usbLinkCommand.cpp) o zero se vuota. Il GBA
  applica la coppia (sua, del Pico) nello stesso frame.
- verso mGBA: il firmware inoltra cio' che riceve dal GBA, ma i "nessun tasto"
  (CAFE 0011) ripetuti li azzera e non li manda (usbSection.hpp); poi rete.
- OGGI (Lua 27/08): mGBA ogni frame mette la coppia (prossimo comando del GBA
  arrivato, suo di adesso), e butta un codice del GBA uguale al precedente entro
  15 frame ("filtro dei tasti doppi").
- SEGUACE (la cura): il Pico riferisce OGNI trasferimento come coppia (ricevuto dal
  GBA, trasmesso al GBA); mGBA non applica i propri tasti subito ma riproduce le
  coppie riferite, una per frame, dopo un piccolo cuscinetto contro il jitter.

Uso: python tools/sim_saletta.py
"""
import random

STEP_FROZEN = 15   # ciclo di 16 frame: il primo decremento e' nel frame del passo
EMPTY, DOWN, UP = 0x11, 0x12, 0x13


class Mover:
    """Un personaggio nella saletta, come lo vede UN gioco."""

    def __init__(self):
        self.frozen = 0
        self.passi = 0

    def frame(self, key):
        if self.frozen:
            self.frozen -= 1          # scende a ogni frame, tasto o no
            return
        if key in (DOWN, UP):
            self.passi += 1
            self.frozen = STEP_FROZEN


def tasti(frames, schema):
    """schema: lista di (inizio, fine, tasto) -> tasto per frame (EMPTY altrove)."""
    out = [EMPTY] * frames
    for a, b, k in schema:
        for f in range(a, min(b, frames)):
            out[f] = k
    return out


def simula(modo, seme, durata_s=20, jitter_ms=12, lat_ms=16, fps_mgba=59.7275,
           cuscinetto=6):
    rnd = random.Random(seme)
    fps_gba = 59.7275
    n_gba = int(durata_s * fps_gba)
    n_mg = int(durata_s * fps_mgba)
    # Il GBA tiene giu' 160 frame (circa 10 passi), poi tocchi rapidi.
    k_gba = tasti(n_gba, [(60, 220, DOWN), (400, 402, UP), (420, 422, UP),
                          (440, 442, UP), (600, 760, UP)])
    # mGBA tiene su 170 frame, poi giu' 100.
    k_mg = tasti(n_mg, [(90, 260, UP), (500, 600, DOWN), (800, 803, DOWN)])

    def t_gba(f): return f / fps_gba * 1000
    def t_mg(f): return f / fps_mgba * 1000
    def ritardo(): return lat_ms + rnd.uniform(0, jitter_ms)

    # --- mGBA -> Pico: i comandi di mGBA arrivano alla coda del Pico -----------
    # OGGI mGBA manda il suo tasto al frame in cui lo preme; SEGUACE uguale.
    arrivi_pico = sorted((t_mg(f) + ritardo(), f, k) for f, k in enumerate(k_mg))

    # --- il GBA: un trasferimento per frame ------------------------------------
    gba_vede_gba, gba_vede_mg = Mover(), Mover()
    coda_pico, i_arr = [], 0
    coppie = []                       # (t, dal GBA, trasmesso dal Pico o None)
    for f in range(n_gba):
        t = t_gba(f)
        while i_arr < len(arrivi_pico) and arrivi_pico[i_arr][0] <= t:
            coda_pico.append(arrivi_pico[i_arr][2]); i_arr += 1
        dal_pico = coda_pico.pop(0) if coda_pico else None
        gba_vede_gba.frame(k_gba[f])
        gba_vede_mg.frame(dal_pico if dal_pico is not None else 0)
        coppie.append((t, k_gba[f], dal_pico))

    # --- mGBA ------------------------------------------------------------------
    mg_vede_gba, mg_vede_mg = Mover(), Mover()
    soppressi = affamati = 0
    if modo == "oggi":
        # Il firmware: i CAFE 0011 ripetuti diventano zero e non partono.
        arrivi, prec_empty = [], False
        for t, g, _ in coppie:
            if g == EMPTY:
                if prec_empty:
                    continue
                prec_empty = True
            else:
                prec_empty = False
            arrivi.append((t + ritardo(), g))
        arrivi.sort()
        coda, i_arr, ult_cod, ult_f = [], 0, -1, -1000
        for f in range(n_mg):
            t = t_mg(f)
            while i_arr < len(arrivi) and arrivi[i_arr][0] <= t:
                coda.append(arrivi[i_arr][1]); i_arr += 1
            g = coda.pop(0) if coda else 0
            if g not in (0, EMPTY):
                if g == ult_cod and f - ult_f < 15:
                    soppressi += 1
                    g = 0
                else:
                    ult_cod, ult_f = g, f
            elif g == EMPTY:
                ult_cod = g
            mg_vede_gba.frame(g)
            mg_vede_mg.frame(k_mg[f])          # il proprio tasto, subito
    else:
        # SEGUACE: ogni coppia riferita dal Pico, nello stesso ordine.
        arrivi = sorted((t + ritardo(), i) for i, (t, _, _) in enumerate(coppie))
        coda, i_arr, pronto, quiete = [], 0, False, 0
        for f in range(n_mg):
            t = t_mg(f)
            while i_arr < len(arrivi) and arrivi[i_arr][0] <= t:
                coda.append(coppie[arrivi[i_arr][1]]); i_arr += 1
            coda.sort()                        # la rete le riordina (seq)
            if not pronto and len(coda) >= cuscinetto:
                pronto = True
            # Come mgba/club_lua.lua: il cuscinetto si ricarica SOLO a bocce
            # ferme (QUIETE_FRAME coppie senza frecce), dove un frame vuoto non
            # cambia niente; in movimento non si aspetta mai.
            if pronto and quiete >= 17 and len(coda) < cuscinetto:
                mg_vede_gba.frame(0)
                mg_vede_mg.frame(0)
                continue
            if pronto and coda:
                _, g, m = coda.pop(0)
                mm = m if m is not None else 0
                quiete = 0 if (g in (DOWN, UP) or mm in (DOWN, UP)) else quiete + 1
                mg_vede_gba.frame(g)
                mg_vede_mg.frame(mm)
            else:
                affamati += 1 if pronto else 0
                mg_vede_gba.frame(0)
                mg_vede_mg.frame(0)

    return {
        "GBA: passi del GBA": gba_vede_gba.passi,
        "mGBA: passi del GBA": mg_vede_gba.passi,
        "mGBA: passi di mGBA": mg_vede_mg.passi,
        "GBA: passi di mGBA": gba_vede_mg.passi,
        "filtrati": soppressi, "frame affamati": affamati,
    }


def main():
    for modo in ("oggi", "seguace"):
        print(f"--- {modo}")
        for fps in (59.7275, 60.0):
            diversi = 0
            for seme in range(200):
                r = simula(modo, seme, fps_mgba=fps)
                if (r["GBA: passi del GBA"] != r["mGBA: passi del GBA"]
                        or r["mGBA: passi di mGBA"] != r["GBA: passi di mGBA"]):
                    diversi += 1
            r = simula(modo, 0, fps_mgba=fps)
            print(f"  mGBA a {fps} fps, esempio: " + ", ".join(f"{k} {v}" for k, v in r.items()))
            print(f"  corse in cui i due giochi NON concordano: {diversi}/200")


if __name__ == "__main__":
    main()
