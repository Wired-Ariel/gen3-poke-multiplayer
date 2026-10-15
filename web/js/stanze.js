/* stanze.js - la pagina Stanze (2026-10-11).
 *
 * Non apre nessuna partita e nessun WebSocket: legge l'elenco delle stanze
 * aperte (GET /ws?stanze, lo stesso indirizzo del relay in http), scrive la
 * stanza scelta nelle impostazioni - le stesse del pannello - e porta alla
 * pagina della stanza.
 *
 * L'INTERRUTTORE «mostra la mia stanza» scrive l'impostazione, non il
 * pacchetto: il segno T_PUBLIC lo puo' mandare solo un GIOCATORE che e'
 * dentro la stanza (relay.py lo ignora da chiunque altro), quindi lo manda
 * il pannello mentre giochi - e lo rinnova ogni 5 s, perche' il relay lo
 * dimentica dopo 15. Se il pannello e' aperto in un'altra scheda se ne
 * accorge subito (evento `storage`).
 *
 * La colonna «ultimo messaggio» del disegno NON c'e', per scelta: per
 * mostrarla il relay dovrebbe aprire i messaggi di chat (oggi non legge il
 * contenuto di niente) e pubblicare a chiunque l'ultima frase di una stanza.
 */
(function () {
  "use strict";
  var S = window.Sito, L = S.L, el = S.el;
  var $ = function (id) { return document.getElementById(id); };
  var OGNI_MS = 5000;
  var ultimoElenco = null;

  function esito(testo, classe) { var e = $("esito-entra"); e.textContent = testo || ""; e.className = "esito" + (classe ? " " + classe : ""); }

  /* «Entra»: la stanza diventa quella delle impostazioni. «Guarda»: no. */
  function vai(n, soloGuarda) {
    if (!soloGuarda) { S.salva({ stanza: n }); }
    S.ricordaUltima(n);
    location.href = S.pagina("stanza", "stanza=" + n + (soloGuarda ? "&guarda=1" : ""));
  }

  function entraDalCampo(ev) {
    if (ev) ev.preventDefault();
    var n = S.stanzaValida($("numero").value);
    if (!n) { esito(L("Scrivi un numero fra 1 e 65535.", "Type a number between 1 and 65535."), "male"); $("numero").focus(); return; }
    vai(n, false);
  }

  /* Un numero a caso fra 1 e 65535 che non sia una stanza gia' in elenco. */
  function stanzaNuova() {
    var prese = {};
    ((ultimoElenco && ultimoElenco.stanze) || []).forEach(function (s) { prese[s.stanza] = true; });
    var n;
    do { n = 1 + Math.floor(Math.random() * 65535); } while (prese[n]);
    $("numero").value = n;
    esito(L("Stanza " + n + ": nuova, e fuori dall'elenco finché non la apri tu. Premi Entra, poi passa il numero agli amici.",
            "Room " + n + ": new, and off the list until you open it. Press Join, then share the number with your friends."), "bene");
    $("numero").focus();
  }

  function pallini(giocatori, posti) {
    var p = el("div", "pallini");
    p.setAttribute("role", "img");
    p.setAttribute("aria-label", giocatori + L(" giocatori su ", " players out of ") + posti);
    for (var i = 0; i < posti; i++) p.appendChild(el("i", i < giocatori ? "pieno" : ""));
    return p;
  }

  function disegnaElenco(d) {
    var box = $("elenco"), mia = S.cfg().stanza;
    box.innerHTML = "";
    var relay = S.cfg().relay;
    var pill = $("pill-relay"), pillTesto = $("pill-relay-testo");
    if (d.errore === "norelay") {
      pill.className = "pillola attesa"; pillTesto.textContent = L("Relay non impostato", "Relay not set");
      $("elenco-conta").textContent = "";
      var v = el("div", "vuoto");
      v.appendChild(document.createTextNode(L("Non c'è un relay nelle impostazioni, quindi non so a chi chiedere l'elenco. Scrivilo nel ", "There's no relay in the settings, so I don't know whom to ask for the list. Enter it in the ")));
      var a = el("a", null, L("Pannello → Impostazioni", "Panel → Settings")); a.href = S.pagina("gioca"); v.appendChild(a);
      v.appendChild(document.createTextNode("."));
      box.appendChild(v);
      return;
    }
    if (d.errore) {
      pill.className = "pillola no"; pillTesto.textContent = L("Relay non risponde", "Relay not answering");
      $("elenco-conta").textContent = "";
      box.appendChild(el("div", "vuoto", d.errore === "muto"
        ? L("Il frontale risponde ma il relay dietro è muto: elenco non disponibile. Si può entrare lo stesso in una stanza scrivendo il numero.", "The front end answers but the relay behind it is silent: list unavailable. You can still join a room by typing its number.")
        : L("Elenco non disponibile: il relay (" + relay + ") non risponde, o è troppo vecchio per le stanze aperte. Riprovo da solo ogni 5 secondi.", "List unavailable: the relay (" + relay + ") isn't answering, or is too old for open rooms. I retry by myself every 5 seconds.")));
      return;
    }
    pill.className = "pillola ok"; pillTesto.textContent = "Relay " + d.ms + " ms";
    pill.title = relay;
    var n = d.stanze.length;
    $("elenco-conta").textContent = (n === 1 ? L("1 adesso", "1 right now") : n + L(" adesso", " right now")) + L(" · si aggiorna da sola", " · refreshes by itself");
    if (!n) {
      box.appendChild(el("div", "vuoto", L("Nessuna stanza aperta in questo momento. Creane una qui sopra: quando giochi dal Pannello con «Mostra la mia stanza nell'elenco» acceso, compare qui e gli altri possono entrare.",
                                           "No open rooms right now. Create one above: when you play from the Panel with «Show my room in the list» on, it shows up here and others can join.")));
      return;
    }
    d.stanze.forEach(function (st) {
      var r = el("div", "riga-stanza");
      var num = el("div", "n", String(st.stanza));
      if (st.stanza === mia) num.appendChild(el("span", "tua", L("la tua", "yours")));
      r.appendChild(num);
      var meta = el("div");
      meta.appendChild(pallini(st.giocatori, d.posti));
      meta.appendChild(el("div", "quanti", st.giocatori + L(" di ", " of ") + d.posti + " · " +
        (st.spettatori === 1 ? L("1 spettatore", "1 spectator") : (st.spettatori || 0) + L(" spettatori", " spectators"))));
      r.appendChild(meta);
      var az = el("div", "azioni");
      if (st.giocatori >= d.posti) az.appendChild(el("span", "piena", L("Piena", "Full")));
      else {
        var b = el("button", "btn verde", L("Entra", "Join")); b.type = "button";
        b.setAttribute("aria-label", L("Entra nella stanza ", "Join room ") + st.stanza);
        b.onclick = function () { vai(st.stanza, false); };
        az.appendChild(b);
      }
      var g = el("button", "btn", L("Guarda", "Watch")); g.type = "button";
      g.setAttribute("aria-label", L("Guarda la stanza ", "Watch room ") + st.stanza);
      g.title = L("Da spettatore: non occupi un posto", "As a spectator: you don't take a seat");
      g.onclick = function () { vai(st.stanza, true); };
      az.appendChild(g);
      r.appendChild(az);
      box.appendChild(r);
    });
  }

  function disegnaLato(d) {
    var c = S.cfg(), u = S.ultima();
    var inElenco = function (n) { var t = null; ((d && d.stanze) || []).forEach(function (s) { if (s.stanza === n) t = s; }); return t; };
    // l'ultima stanza
    $("scheda-ultima").hidden = !u;
    if (u) {
      $("ultima-numero").textContent = u.stanza;
      var st = inElenco(u.stanza);
      $("ultima-nota").textContent = st
        ? (st.giocatori === 1 ? L("C'è 1 giocatore dentro, adesso.", "1 player is in there right now.") : L("Ci sono " + st.giocatori + " giocatori dentro, adesso.", st.giocatori + " players are in there right now."))
        : L("Non è nell'elenco delle stanze aperte: può essere privata, o vuota.", "It's not in the open-room list: it may be private, or empty.");
      $("btn-ultima").onclick = function () { vai(u.stanza, false); };
    }
    // l'interruttore
    $("int-aperta").setAttribute("aria-pressed", String(!!c.aperta));
    var mia = inElenco(c.stanza);
    $("aperta-nota").textContent = !c.aperta
      ? (mia ? L("La tua stanza è la " + c.stanza + ": è nell'elenco perché l'ha aperta un altro giocatore.", "Your room is " + c.stanza + ": it's on the list because another player opened it.")
             : L("La tua stanza è la " + c.stanza + " e non compare nell'elenco.", "Your room is " + c.stanza + " and it's not on the list."))
      : (mia ? L("La stanza " + c.stanza + " è nell'elenco, adesso.", "Room " + c.stanza + " is on the list right now.")
             : L("Acceso: la stanza " + c.stanza + " entra nell'elenco quando stai giocando dal Pannello (è il giocatore a tenerla aperta, rinnovando il segno ogni 5 secondi).",
                 "On: room " + c.stanza + " enters the list while you're playing from the Panel (the player keeps it open, renewing the mark every 5 seconds)."));
  }

  function aggiorna() {
    S.elencoStanze(S.cfg().relay).then(function (d) {
      ultimoElenco = d;
      disegnaElenco(d);
      disegnaLato(d);
    });
  }

  window.addEventListener("load", function () {
    var daUrl = S.stanzaDaUrl();
    if (daUrl) {
      $("numero").value = daUrl;
      esito(L("Stanza " + daUrl + " dall'invito: premi Entra.", "Room " + daUrl + " from the invite: press Join."), "bene");
    }
    $("form-entra").addEventListener("submit", entraDalCampo);
    $("btn-nuova").onclick = stanzaNuova;
    $("int-aperta").onclick = function () {
      var ora = this.getAttribute("aria-pressed") !== "true";
      S.salva({ aperta: ora });
      disegnaLato(ultimoElenco);
      setTimeout(aggiorna, 1500);
    };
    disegnaLato(null);
    aggiorna();
    // Solo a pagina visibile: nascosta non la guarda nessuno.
    setInterval(function () { if (document.visibilityState === "visible") aggiorna(); }, OGNI_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) aggiorna(); });
    window.addEventListener("storage", function () { disegnaLato(ultimoElenco); });
  });
})();
