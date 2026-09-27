/*
 * battito.js - timer che non si addormentano quando la scheda e' nascosta
 * (2026-09-27).
 *
 * IL DIFETTO DAL CAMPO. «Il gioco crasha se metti il browser in background»
 * (community GB-Link, 2026-09-27). Il traffico vero di questa pagina va a
 * eventi (le letture USB sono promesse, il WebSocket ha onmessage) e il
 * browser non lo rallenta; i TIMER si'. In una scheda nascosta Chrome ed Edge
 * portano setInterval/setTimeout a un colpo al secondo, e dopo 5 minuti
 * nascosta a uno al MINUTO (il "throttling intensivo"). Il battito del club
 * batte ogni 100 ms e fa i rilanci dell'ultimo blocco (0,3 s), i riannunci e
 * i watchdog: a un colpo al minuto la sessione di link muore e il GBA va in
 * errore di comunicazione.
 *
 * LA CURA. I timer di un Dedicated Worker non seguono quelle regole: il
 * worker conta il tempo e manda un messaggio, e i messaggi arrivano alla
 * pagina anche da nascosta. Qui c'e' un solo worker (nato da un Blob, niente
 * file in piu' da servire) e un'API con la stessa forma di quelle del
 * browser. Se il Worker non c'e' o non parte, si ricade sui timer normali:
 * la pagina funziona come prima.
 *
 * Misurato in Edge: vedi NOTES, blocco del 2026-09-27 sul battito.
 */
(function (root) {
  "use strict";

  var SRC =
    "var t = {};\n" +
    "onmessage = function (e) {\n" +
    "  var d = e.data;\n" +
    "  if (d.op === 'i') t[d.id] = setInterval(function () { postMessage(d.id); }, d.ms);\n" +
    "  else if (d.op === 't') t[d.id] = setTimeout(function () { delete t[d.id]; postMessage(d.id); }, d.ms);\n" +
    "  else { clearInterval(t[d.id]); clearTimeout(t[d.id]); delete t[d.id]; }\n" +
    "};\n";

  var worker = null, seq = 0, cbs = {};

  function nasci() {
    try {
      var url = URL.createObjectURL(new Blob([SRC], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = function (e) {
        var c = cbs[e.data];
        if (!c) return;              // gia' cancellato: il messaggio era in volo
        if (c.una) delete cbs[e.data];
        c.fn();
      };
    } catch (e) {
      worker = null;
    }
  }
  if (typeof Worker !== "undefined" && typeof Blob !== "undefined" && typeof URL !== "undefined") nasci();

  function programma(op, fn, ms) {
    if (!worker) return { nativo: op === "i" ? root.setInterval(fn, ms) : root.setTimeout(fn, ms), op: op };
    var id = ++seq;
    cbs[id] = { fn: fn, una: op === "t" };
    worker.postMessage({ op: op, id: id, ms: ms });
    return { id: id };
  }

  root.Battito = {
    setInterval: function (fn, ms) { return programma("i", fn, ms); },
    setTimeout: function (fn, ms) { return programma("t", fn, ms); },
    /* Vale per tutti e due. Accetta anche null, come clearInterval. */
    clear: function (h) {
      if (!h) return;
      if (h.nativo !== undefined) {
        if (h.op === "i") root.clearInterval(h.nativo); else root.clearTimeout(h.nativo);
        return;
      }
      delete cbs[h.id];
      if (worker) worker.postMessage({ op: "c", id: h.id });
    },
    /* true se i timer stanno davvero nel worker (per il registro). */
    attivo: function () { return !!worker; }
  };
})(typeof window !== "undefined" ? window : this);
