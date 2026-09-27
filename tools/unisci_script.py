#!/usr/bin/env python3
"""
unisci_script.py - lo script mGBA UNIVERSALE: una versione sola per tutte le
lingue di Smeraldo (2026-09-27).

PERCHE'. Fino alla v1.5 c'erano due script, uno per Smeraldo italiano (BPEI)
e uno per Emerald inglese (BPEE), e il sito faceva scegliere. Misurato: i due
payload hanno la stessa dimensione e differiscono in 50 parole, TUTTE indirizzi
di funzioni in ROM. Quindi basta uno script con il payload italiano e, per ogni
lingua, le parole da rimettere; l'iniettore (mgba/inject_body.lua, romMatches)
legge il gamecode della ROM caricata e ricuce. E' la stessa idea dello stub
universale (hw/mbstub/build.ps1 -Syms tutte).

COME. Prende i due script generati come sempre da build.ps1 (stessi parametri,
uno -Syms it e uno -Syms usa) e controlla che siano lo STESSO script tranne:
  - i byte del payload (stessa lunghezza; solo parole che in ogni lingua sono
    indirizzi ROM 0x08xxxxxx),
  - le righe ROM_* dell'intestazione (ci sono solo nello script italiano).
Qualunque altra differenza lo ferma: vorrebbe dire che non sono due lingue
dello stesso codice. Poi scrive lo script italiano con in piu', subito prima
del payload, ROM_TOPPE_OFF e ROM_LINGUE.

    python tools/unisci_script.py <script-it.lua> <script-usa.lua> <uscita.lua>
"""

import os
import re
import struct
import sys

def leggi(path):
    with open(path, encoding="latin-1", newline="") as f:
        testo = f.read()
    righe = testo.split("\n")
    chunk_re = re.compile(r'^__chunks\[#__chunks \+ 1\] = "((?:\\\d{1,3})*)"\r?$')
    byte = bytearray()
    altre = []
    for r in righe:
        m = chunk_re.match(r)
        if m:
            byte += bytes(int(x) for x in m.group(1).split("\\")[1:])
        else:
            altre.append(r)
    return testo, righe, bytes(byte), altre


def rom(righe, nome, predefinito):
    for r in righe:
        m = re.match(r"^ROM_%s = (0x[0-9A-Fa-f]+)\r?$" % nome, r)
        if m:
            return int(m.group(1), 16)
    return predefinito


def predefiniti_usa(corpo):
    """I valori USA di inject_body.lua: `ROM_X or 0x...`."""
    out = {}
    for nome in ("CB2_OVERWORLD", "CB2_WORD", "CB1_OVERWORLD"):
        m = re.search(r"ROM_%s or (0x[0-9A-Fa-f]+)" % nome, corpo)
        if not m:
            raise SystemExit("in inject_body.lua manca il predefinito di ROM_%s" % nome)
        out[nome] = int(m.group(1), 16)
    return out


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        return 2
    t_it, r_it, p_it, a_it = leggi(sys.argv[1])
    t_us, r_us, p_us, a_us = leggi(sys.argv[2])

    senza_rom = lambda righe: [r for r in righe if not r.startswith("ROM_")]
    if senza_rom(a_it) != senza_rom(a_us):
        diff = [(i, x, y) for i, (x, y) in enumerate(zip(senza_rom(a_it), senza_rom(a_us))) if x != y][:5]
        raise SystemExit("i due script differiscono anche fuori dal payload e dalle righe ROM_*: %r" % diff)
    if len(p_it) != len(p_us) or not p_it:
        raise SystemExit("payload di lunghezza diversa (it %d, usa %d)" % (len(p_it), len(p_us)))
    if not any(r.startswith("ROM_GAMECODE") for r in a_it):
        raise SystemExit("il primo script non e' quello italiano (manca ROM_GAMECODE)")

    offs = []
    for o in range(0, len(p_it) - 3, 4):
        a = struct.unpack_from("<I", p_it, o)[0]
        b = struct.unpack_from("<I", p_us, o)[0]
        if a == b:
            continue
        if (a >> 24) != 0x08 or (b >> 24) != 0x08:
            raise SystemExit("a +0x%X le parole 0x%08X / 0x%08X non sono indirizzi ROM" % (o, a, b))
        offs.append(o)
    if not offs or len(offs) > 200:
        raise SystemExit("parole diverse: %d (attese fra 1 e 200)" % len(offs))

    radice = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    corpo = open(os.path.join(radice, "mgba", "inject_body.lua"), encoding="utf-8").read()
    usa = predefiniti_usa(corpo)
    it = {n: rom(r_it, n, None) for n in ("CB2_OVERWORLD", "CB2_WORD", "CB1_OVERWORLD")}
    if None in it.values():
        raise SystemExit("mancano righe ROM_* nello script italiano: %r" % it)

    def riga(code, v, payload):
        top = ", ".join("0x%08X" % struct.unpack_from("<I", payload, o)[0] for o in offs)
        return ("    %s = { cb2 = 0x%08X, cb2word = 0x%08X, cb1 = 0x%08X,\n      toppe = { %s } },"
                % (code, v["CB2_OVERWORLD"], v["CB2_WORD"], v["CB1_OVERWORLD"], top))

    blocco = [
        "-- LO SCRIPT UNIVERSALE (generato da tools/unisci_script.py): il payload qui",
        "-- sotto e' quello ITALIANO; per ogni lingua le parole (offset in byte) che",
        "-- romMatches rimette prima di iniettare. Una versione sola per tutti.",
        "ROM_TOPPE_OFF = { %s }" % ", ".join(str(o) for o in offs),
        "ROM_LINGUE = {",
        riga("BPEI", it, p_it),
        riga("BPEE", usa, p_us),
        "}",
    ]
    nl = "\r\n" if "\r\n" in t_it else "\n"
    marca = "local __chunks = {}"
    if t_it.count(marca) != 1:
        raise SystemExit("marcatore '%s' non trovato una volta sola" % marca)
    out = t_it.replace(marca, nl.join(blocco) + nl + marca)
    with open(sys.argv[3], "w", encoding="latin-1", newline="") as f:
        f.write(out)
    print("universale: %d byte di payload, %d parole da ricucire, lingue BPEI + BPEE -> %s"
          % (len(p_it), len(offs), sys.argv[3]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
