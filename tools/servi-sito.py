#!/usr/bin/env python3
"""
servi-sito.py - il sito in locale, senza assemblarlo (2026-10-11). Solo stdlib.

`prepara-sito-web.ps1` costruisce la cartella da pubblicare, ma vuole lo stub
compilato e rigenera gli script: per lavorare alle pagine e' troppo. Questo
serve web/ COSI' COM'E', con le tre cose che nel sito pubblicato stanno
accanto alle pagine e nel repository no:

    /mappa.html   -> net/mappa.html        (lo stesso file del pannello Python)
    /mappa/...    -> net/mappa/...         (i dati di tools/gen_mappa.py), oppure
                                           la cartella data con --mappa
    il resto che manca (mbstub.gba, gli script .lua) -> la cartella --extra,
    per esempio un sito gia' assemblato in build/sito-web

    python tools/servi-sito.py [--port 7413] [--mappa CARTELLA] [--extra CARTELLA]

Poi http://127.0.0.1:7413/gioca.html in Chrome o Edge (localhost vale come
https per WebUSB). Ascolta SOLO su loopback. Niente cache: ogni ricarica
prende i file di adesso.
"""

import argparse
import os
import posixpath
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

QUI = os.path.dirname(os.path.abspath(__file__))
RADICE = os.path.dirname(QUI)
WEB = os.path.join(RADICE, "web")
NET = os.path.join(RADICE, "net")


class Sito(SimpleHTTPRequestHandler):
    mappa = os.path.join(NET, "mappa")
    extra = None

    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".woff2": "font/woff2", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8", ".lua": "text/plain; charset=utf-8",
        ".gba": "application/octet-stream",
    })

    def translate_path(self, path):
        path = urllib.parse.unquote(path.split("?", 1)[0].split("#", 1)[0])
        pezzi = [p for p in posixpath.normpath(path).split("/") if p and p not in (".", "..")]
        if pezzi == ["mappa.html"]:
            return os.path.join(NET, "mappa.html")
        if pezzi and pezzi[0] == "mappa":
            return os.path.join(self.mappa, *pezzi[1:])
        strada = os.path.join(WEB, *pezzi)
        if not os.path.exists(strada) and self.extra:
            altra = os.path.join(self.extra, *pezzi)
            if os.path.exists(altra):
                return altra
        return strada

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.server.verboso or (len(args) > 1 and str(args[1]).startswith(("4", "5"))):
            sys.stderr.write("[sito ] %s\n" % (fmt % args))


def main():
    ap = argparse.ArgumentParser(description="Serve web/ in locale, con mappa.html e i dati della mappa")
    ap.add_argument("--port", type=int, default=7413)
    ap.add_argument("--mappa", default="", help="cartella dei dati della mappa (default: net/mappa)")
    ap.add_argument("--extra", default="", help="cartella di ripiego per i file che in web/ non ci sono")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    if args.mappa:
        Sito.mappa = os.path.abspath(args.mappa)
    if args.extra:
        Sito.extra = os.path.abspath(args.extra)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Sito)
    srv.verboso = args.verbose
    print("[sito ] http://127.0.0.1:%d/gioca.html   (web: %s, mappa: %s%s)"
          % (args.port, WEB, Sito.mappa, (", extra: " + Sito.extra) if Sito.extra else ""), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
