#!/usr/bin/env python3
"""
gen_en.py - genera le pagine inglesi del sito da quelle italiane (2026-10-11).

Fino alla 1.7 ogni pagina esisteva in due file scritti a mano (pagina.html e
pagina-en.html), e a ogni modifica una delle due restava indietro. Dalla 1.8
le pagine nuove tengono LE DUE LINGUE NELLO STESSO FILE:

    <span class="l-it">Stanze</span><span class="l-en">Rooms</span>
    <input placeholder="vuoto = nessuno" data-en-placeholder="empty = none">
    <button title="..." data-en-title="..." aria-label="..." data-en-aria-label="...">
    <option value="auto" data-en="automatic">automatico</option>
    <title data-en="Rooms">Stanze</title>

e css/sito.css mostra la lingua di <html lang>. Questo script produce
pagina-en.html da pagina.html: cambia `lang`, il titolo, gli attributi
data-en-*, il <link rel="alternate"> e i collegamenti fra le pagine (che in
inglese puntano alle gemelle -en). Il testo .l-it resta nel file, nascosto:
il file inglese e' la STESSA pagina, non una traduzione che puo' divergere.

    python tools/gen_en.py            # rigenera tutte
    python tools/gen_en.py --check    # esce con 1 se una -en non e' aggiornata

Le pagine generate portano in testa un avviso: NON si modificano a mano.
`prepara-sito-web.ps1` lo lancia con --check prima di assemblare il sito.
"""

import io
import os
import re
import sys

QUI = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(QUI), "web")

# Le pagine generate, e TUTTE quelle che esistono in due lingue (i link verso
# queste, in una pagina inglese, vanno alla gemella -en).
GENERATE = ["gioca", "stanze", "stanza", "progetto"]
BILINGUI = ["index", "gioca", "stanze", "stanza", "progetto"]

AVVISO = ("<!-- GENERATO da tools/gen_en.py a partire da %s.html: NON modificare a mano.\n"
          "     Si cambia %s.html (il testo inglese e' li' dentro) e si rilancia lo script. -->\n")


def _attributi(m):
    """In un tag, ogni data-en-X="v" diventa X="v" (al posto di quello che c'era)."""
    tag = m.group(0)
    for nome, valore in re.findall(r'\sdata-en-([a-z-]+)="([^"]*)"', tag):
        tag = re.sub(r'\sdata-en-%s="[^"]*"' % re.escape(nome), "", tag, count=1)
        if re.search(r'\s%s="[^"]*"' % re.escape(nome), tag):
            tag = re.sub(r'(\s%s=")[^"]*(")' % re.escape(nome),
                         lambda mm: mm.group(1) + valore + mm.group(2), tag, count=1)
        else:
            tag = re.sub(r'(/?>)$', lambda mm: ' %s="%s"%s' % (nome, valore, mm.group(1)), tag, count=1)
    return tag


def traduci(nome, testo):
    """Il sorgente italiano di `nome`.html -> il testo di `nome`-en.html."""
    s = testo.replace("\r\n", "\n")
    s, n = re.subn(r'<html lang="it">', '<html lang="en">', s, count=1)
    if n != 1:
        raise ValueError('%s.html: manca <html lang="it">' % nome)
    # il contenuto di <title> e <option> con data-en
    s = re.sub(r'<(title|option)\b([^>]*?)\sdata-en="([^"]*)"([^>]*)>[^<]*</\1>',
               lambda m: "<%s%s%s>%s</%s>" % (m.group(1), m.group(2), m.group(4), m.group(3), m.group(1)), s)
    # gli attributi
    s = re.sub(r'<[a-zA-Z][^<>]*\sdata-en-[a-z-]+="[^<>]*>', _attributi, s)
    # i collegamenti fra le pagine
    s = re.sub(r'(href=")(%s)\.html(["?#])' % "|".join(BILINGUI),
               lambda m: "%s%s-en.html%s" % (m.group(1), m.group(2), m.group(3)), s)
    # il collegamento alla gemella (DOPO: altrimenti la riga qui sopra lo
    # riporterebbe alla pagina inglese stessa)
    gemella = '<link rel="alternate" hreflang="en" href="%s-en.html">' % nome
    if gemella not in s:
        raise ValueError("%s.html: manca %s" % (nome, gemella))
    s = s.replace(gemella, '<link rel="alternate" hreflang="it" href="%s.html">' % nome)
    # l'avviso, subito dopo il doctype
    s = re.sub(r'^(<!doctype html>\n)', lambda m: m.group(1) + AVVISO % (nome, nome), s, count=1, flags=re.I)
    if "data-en" in re.sub(r'<!--.*?-->', "", s, flags=re.S):
        resto = re.findall(r'<[^<>]*data-en[^<>]*>', re.sub(r'<!--.*?-->', "", s, flags=re.S))
        raise ValueError("%s.html: attributi data-en che non so tradurre: %s" % (nome, resto[:3]))
    return s


def main():
    controlla = "--check" in sys.argv
    vecchie = []
    for nome in GENERATE:
        sorgente = os.path.join(WEB, nome + ".html")
        if not os.path.exists(sorgente):
            print("gen_en : %s.html non c'e' ancora, salto" % nome)
            continue
        with io.open(sorgente, encoding="utf-8", newline="") as f:
            italiano = f.read()
        # Una pagina che non ha ancora le due lingue dentro NON si genera: la
        # sua -en e' scritta a mano, e sovrascriverla la cancellerebbe.
        if 'class="l-en"' not in italiano and "l-en" not in italiano:
            print("gen_en : %s.html non ha il testo inglese dentro (.l-en): la sua -en resta com'e'" % nome)
            continue
        atteso = traduci(nome, italiano)
        dest = os.path.join(WEB, nome + "-en.html")
        attuale = None
        if os.path.exists(dest):
            with io.open(dest, encoding="utf-8", newline="") as f:
                attuale = f.read().replace("\r\n", "\n")
        if attuale == atteso:
            print("gen_en : %s-en.html aggiornata" % nome)
            continue
        if controlla:
            vecchie.append(nome)
            print("gen_en : %s-en.html NON e' aggiornata rispetto a %s.html" % (nome, nome))
            continue
        with io.open(dest, "w", encoding="utf-8", newline="\n") as f:
            f.write(atteso)
        print("gen_en : %s-en.html scritta (%d byte)" % (nome, len(atteso.encode("utf-8"))))
    if vecchie:
        print("gen_en : rilancia  python tools/gen_en.py  e riprova")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
