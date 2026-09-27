#!/usr/bin/env python3
"""
gen_icons.py - genera la grafica 4bpp degli indicatori di stato (128 byte per
icona, il totale lo decide la lista ICONS qui sotto).

Le icone (palla, "...", zaino, squadra, pokedex, pokenav, menu generico) sono
l'unico pezzo di grafica che il payload
si porta dietro invece di riusare qualcosa che sta gia' in ROM. Il motivo sta in
payload/main.c: il campo ha gia' le icone sopra la testa (FLDEFF_EXCLAMATION_
MARK_ICON e compagne), ma sono animazioni one-shot che si spengono da sole, e i
disegni che servono a noi non esistono come oggetti di campo.

Questo script NON viene chiamato dalla build: si lancia a mano quando si vuole
cambiare un disegno, e il suo output si incolla dentro sIndicatorTilesLz[] in
payload/main.c. Esiste perche' quei 384 byte esadecimali, a rileggerli fra sei
mesi, non dicono niente - le mappe di pixel qui sotto invece si leggono.

Uso:
    python tools/gen_icons.py            stampa l'array C da incollare
    python tools/gen_icons.py --check    decomprime l'array LZ77 gia' in main.c e
                                         lo ristampa come mappe di pixel

Formato: ogni icona e' 16x16 = 4 tile 8x8 in ordine 1D (alto-sinistra,
alto-destra, basso-sinistra, basso-destra). Un tile 4bpp e' 32 byte, un byte e'
due pixel e il nibble BASSO e' il pixel di sinistra.
"""

import re
import sys
from pathlib import Path

# GLI INDICI SONO QUELLI DELLA PALETTE DELL'AVATAR DELL'AMICO (2026-09-27).
# L'icona non ha piu' una palette propria: in overworld gli slot liberi sono
# quattro, il meteo ne tiene due e gli effetti a terra gli altri due (0x1004
# sabbia/schizzi/polvere, 0x1005 erba/increspature), e la nostra palette ne
# rubava uno (misurato: mgba/banco_surf.lua, mgba/banco_polvere.lua). Ora lo
# sprite usa lo stesso paletteNum dello sprite del remoto, che e' gia' caricato.
# Il remoto e' sempre Brendan o May (graphics/object_events/palettes/
# brendan.pal, may.pal): gli indici 12-15 sono IDENTICI nelle due (rosso
# 255,98,90 - rosso scuro 197,65,65 - bianco - nero), gli altri vicini.
PAL = {
    '.': 0,   # trasparente
    'k': 15,  # nero, contorno        (0,0,0 in entrambe)
    'w': 14,  # bianco                (255,255,255 in entrambe)
    'r': 12,  # rosso                 (255,98,90 in entrambe)
    'd': 13,  # rosso scuro           (197,65,65 in entrambe)
    'g': 9,   # grigio chiaro         (222,230,238 / 205,205,222)
    'G': 6,   # grigio scuro          (41,57,98 / 41,57,65)
    'b': 3,   # marrone -> terracotta (222,148,115 / 205,131,115)
    'B': 4,   # marrone scuro         (123,65,65 / 123,90,82)
    'y': 1,   # giallo -> crema       (255,213,180 / 255,222,205): il giallo non c'e'
}
CHARS = ".kwrdgGbBy"
INV = {v: k for k, v in PAL.items()}

# 10x10 invece di 14x14: a tutta tela copriva mezza testa del remoto
# (richiesta di Lain, 2026-07-30, quarta sessione di Fase 7).
BALL = [
    "................",
    "................",
    "................",
    ".....kkkkkk.....",
    "....krrrrrrk....",
    "...krrrrrrrrk...",
    "...krrrrrrrrk...",
    "...kkkkwwkkkk...",
    "...kkkkwwkkkk...",
    "...kwwwwwwwwk...",
    "...kwwwwwwwwk...",
    "....kwwwwwwk....",
    ".....kkkkkk.....",
    "................",
    "................",
    "................",
]

DOTS = [
    "................",
    "..kkkkkkkkkkkk..",
    ".kwwwwwwwwwwwwk.",
    ".kwwwwwwwwwwwwk.",
    ".kwkkwwkkwwkkwk.",
    ".kwkkwwkkwwkkwk.",
    ".kwwwwwwwwwwwwk.",
    ".kwwwwwwwwwwwwk.",
    "..kkkwwkkkkkkk..",
    "....kwwk........",
    ".....kk.........",
    "................",
    "................",
    "................",
    "................",
    "................",
]

BAG = [
    "................",
    "......kkkk......",
    ".....kbbbbk.....",
    "....kbBBBBbk....",
    "...kkkkkkkkkk...",
    "..kbbbbbbbbbbk..",
    "..kbbbbbbbbbbk..",
    "..kbbBBBBBBbbk..",
    "..kbbByyyyBbbk..",
    "..kbbBBBBBBbbk..",
    "..kbbbbbbbbbbk..",
    "..kbbbbbbbbbbk..",
    "..kkkkkkkkkkkk..",
    "................",
    "................",
    "................",
]

# Le sezioni del menu START riconoscibili dal .map (vedi gen_syms.py).
# Squadra: tre mini-palle in triangolo, per non confonderla con la palla
# grande della lotta.
PARTY = [
    "................",
    "......kkkk......",
    ".....krrrrk.....",
    ".....kkkkkk.....",
    ".....kwwwwk.....",
    "......kkkk......",
    "................",
    "................",
    "..kkkk....kkkk..",
    ".krrrrk..krrrrk.",
    ".kkkkkk..kkkkkk.",
    ".kwwwwk..kwwwwk.",
    "..kkkk....kkkk..",
    "................",
    "................",
    "................",
]

# Pokedex: libro rosso con la costa scura, la lente e la fessura.
DEX = [
    "................",
    "................",
    "..kkkkkkkkkkkk..",
    "..kddrrkkrrrrk..",
    "..kddrkwwkrrrk..",
    "..kddrkwwkrrrk..",
    "..kddrrkkrrrrk..",
    "..kddrrrrrrrrk..",
    "..kddrrrrrrrrk..",
    "..kddrkkkkkrrk..",
    "..kddrrrrrrrrk..",
    "..kddrrrrrrrrk..",
    "..kddrrrrrrrrk..",
    "..kkkkkkkkkkkk..",
    "................",
    "................",
]

# PokeNav: dispositivo giallo con lo schermo (mappa grigia) e tre tasti.
NAV = [
    "................",
    "................",
    "..kkkkkkkkkkkk..",
    "..kyyyyyyyyyyk..",
    "..kykkkkkkkkyk..",
    "..kykwwwwwwkyk..",
    "..kykwGGGGwkyk..",
    "..kykwGwwGwkyk..",
    "..kykwwwwwwkyk..",
    "..kykkkkkkkkyk..",
    "..kyyyyyyyyyyk..",
    "..kyyGyyGyyGyk..",
    "..kyyyyyyyyyyk..",
    "..kkkkkkkkkkkk..",
    "................",
    "................",
]

# Menu generico: finestra bianca con le righe di testo. E' il ripiego per le
# schermate che non si possono riconoscere dal .map (Trainer Card, Opzioni,
# PC): meglio un'icona onesta che una sbagliata.
MENU = [
    "................",
    "................",
    "................",
    "..kkkkkkkkkkkk..",
    "..kwwwwwwwwwwk..",
    "..kwGGGGGwwwwk..",
    "..kwwwwwwwwwwk..",
    "..kwGGGGGGGwwk..",
    "..kwwwwwwwwwwk..",
    "..kwGGGGGGwwwk..",
    "..kwwwwwwwwwwk..",
    "..kwwwwwwwwwwk..",
    "..kkkkkkkkkkkk..",
    "................",
    "................",
    "................",
]

# L'ORDINE E' UN CONTRATTO con ICON_* in payload/main.c: si toccano insieme.
ICONS = [("palla (l'amico e' in lotta)", BALL),
         ('"..." (l\'amico e\' dentro un dialogo o uno script)', DOTS),
         ("zaino (l'amico e' nella Borsa)", BAG),
         ("squadra (l'amico e' nel menu Pokemon)", PARTY),
         ("pokedex", DEX),
         ("pokenav", NAV),
         ("menu generico (Trainer Card, Opzioni, PC, ...)", MENU)]


def encode(rows):
    if len(rows) != 16 or any(len(r) != 16 for r in rows):
        raise SystemExit("ogni icona deve essere esattamente 16x16")

    out = []
    for ty in (0, 1):
        for tx in (0, 1):
            for py in range(8):
                row = rows[ty * 8 + py]
                for px in range(0, 8, 2):
                    lo = PAL[row[tx * 8 + px]]
                    hi = PAL[row[tx * 8 + px + 1]]
                    out.append((hi << 4) | lo)
    return out


def decode(data):
    """L'inverso esatto di encode: serve al --check."""
    grid = [[0] * 16 for _ in range(16)]
    i = 0
    for ty in (0, 1):
        for tx in (0, 1):
            for py in range(8):
                for px in range(0, 8, 2):
                    b = data[i]
                    i += 1
                    grid[ty * 8 + py][tx * 8 + px] = b & 0xF
                    grid[ty * 8 + py][tx * 8 + px + 1] = b >> 4
    return ["".join(INV.get(v, "?") for v in row) for row in grid]


def lz77_gba(data):
    """Encoder LZ77 nel formato del BIOS GBA (SWI 11h, LZ77UnCompWram): header
    0x10 | size<<8, poi blocchi di 8 token guidati da un byte di flag (bit 7 =
    primo token); token = byte letterale, oppure 2 byte (len-3)<<4 | (disp-1)
    con disp nella finestra di 4096 e len 3..18. E' il formato che il gioco usa
    per la propria grafica e che LoadCompressedSpriteSheet decomprime in
    gDecompressionBuffer (decompress.c:22-31). Cerca il match piu' lungo,
    esaustivo: 896 byte, non conta il tempo."""
    n = len(data)
    out = bytearray([0x10, n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF])
    i = 0
    while i < n:
        flags = 0
        block = bytearray()
        for bit in range(8):
            if i >= n:
                break
            best_len, best_disp = 0, 0
            for j in range(max(0, i - 4096), i):
                l = 0
                while l < 18 and i + l < n and data[j + l] == data[i + l]:
                    l += 1
                if l > best_len:
                    best_len, best_disp = l, i - j
            if best_len >= 3:
                flags |= 0x80 >> bit
                block.append(((best_len - 3) << 4) | ((best_disp - 1) >> 8))
                block.append((best_disp - 1) & 0xFF)
                i += best_len
            else:
                block.append(data[i])
                i += 1
        out.append(flags)
        out += block
    while len(out) % 4:          # il BIOS legge l'header come word: allineato
        out.append(0)
    return bytes(out)


def lz77_dec(src):
    """L'inverso esatto di lz77_gba (lo stesso algoritmo del BIOS): serve al
    --check, che ridecodifica l'array compresso di main.c."""
    n = src[1] | (src[2] << 8) | (src[3] << 16)
    out = bytearray()
    i = 4
    while len(out) < n:
        flags = src[i]
        i += 1
        for bit in range(8):
            if len(out) >= n:
                break
            if flags & (0x80 >> bit):
                b0, b1 = src[i], src[i + 1]
                i += 2
                length = (b0 >> 4) + 3
                disp = (((b0 & 0xF) << 8) | b1) + 1
                for _ in range(length):
                    out.append(out[-disp])
            else:
                out.append(src[i])
                i += 1
    return bytes(out)


def raw_sheet():
    return bytes(b for _, rows in ICONS for b in encode(rows))


def emit():
    raw = raw_sheet()
    lz = lz77_gba(raw)
    assert lz77_dec(lz) == raw
    print("/* da incollare in sIndicatorTilesLz[%d], payload/main.c - %d icone, "
          "%d byte grezzi */" % (len(lz), len(ICONS), len(raw)))
    for i in range(0, len(lz), 16):
        print("    " + ", ".join("0x%02X" % b for b in lz[i:i + 16]) + ",")


def preview(out_png):
    """Le icone come le vedra' il GBA, con la palette di Brendan (sopra) e di May
    (sotto), ingrandite 4x. Serve solo a guardarle."""
    from PIL import Image
    base = Path(__file__).resolve().parent.parent.parent / "repo-studio" / "pokeemerald" / "graphics" / "object_events" / "palettes"
    pals = []
    for name in ("brendan.pal", "may.pal"):
        righe = (base / name).read_text().splitlines()[3:19]
        pals.append([tuple(int(x) for x in r.split()) for r in righe])
    img = Image.new("RGB", (16 * len(ICONS) * 4, 32 * 4), (80, 160, 120))
    for row, pal in enumerate(pals):
        for n, (_, rows) in enumerate(ICONS):
            for y, r in enumerate(rows):
                for x, ch in enumerate(r):
                    v = PAL[ch]
                    if v == 0:
                        continue
                    for dy in range(4):
                        for dx in range(4):
                            img.putpixel(((n * 16 + x) * 4 + dx, (row * 16 + y) * 4 + dy), pal[v])
    img.save(out_png)
    print("anteprima:", out_png)


def check():
    total = 128 * len(ICONS)
    src = (Path(__file__).resolve().parent.parent / "payload" / "main.c").read_text()
    m = re.search(r"sIndicatorTilesLz\[(\d+)\][^=]*= \{", src)
    if not m:
        raise SystemExit("sIndicatorTilesLz non trovato in main.c")
    blk = src[m.end():].split("};", 1)[0]
    lz = bytes(int(v, 16) for v in re.findall(r"0x([0-9A-Fa-f]{2})", blk))
    if len(lz) != int(m.group(1)):
        raise SystemExit("main.c dichiara sIndicatorTilesLz[%s] ma contiene %d byte"
                         % (m.group(1), len(lz)))
    if len(lz) % 4:
        raise SystemExit("l'array compresso deve essere multiplo di 4 (header word)")
    vals = lz77_dec(lz)
    if len(vals) != total:
        raise SystemExit("decompresso %d byte invece di %d: icone cambiate o array "
                         "non rigenerato" % (len(vals), total))
    ok = True
    for n, (name, rows) in enumerate(ICONS):
        got = decode(vals[n * 128:(n + 1) * 128])
        print("%d - %s%s" % (n, name, "" if got == rows else "   <-- DIVERSA"))
        for line in got:
            print("   " + line)
        ok = ok and got == rows

    print("main.c (LZ77, %d byte per %d grezzi) e le mappe di questo file coincidono"
          % (len(lz), total) if ok
          else "ATTENZIONE: main.c non corrisponde piu' alle mappe di questo file")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--anteprima" in sys.argv:
        sys.exit(preview(sys.argv[sys.argv.index("--anteprima") + 1]) or 0)
    sys.exit(check() if "--check" in sys.argv else (emit() or 0))
