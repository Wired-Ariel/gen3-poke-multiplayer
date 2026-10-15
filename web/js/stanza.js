/* stanza.js - la pagina di una stanza (2026-10-11).
 *
 * DUE MODI, e la pagina sceglie da sola:
 *
 *   OSPITE     in un'altra scheda il pannello sta giocando (o guardando) in
 *              questa stanza. Qui non si apre nessun collegamento: stato e
 *              chat arrivano dal pannello su un BroadcastChannel, e i
 *              messaggi scritti qui partono attraverso di lui, col suo nome.
 *   AUTONOMO   nessun pannello in questa stanza: la pagina si collega al
 *              relay da SPETTATORE (T_WATCH, bridge.js senza device). Non
 *              occupa un posto, riceve posizioni e chat, in chat puo'
 *              scrivere, e pubblica le posizioni per la Mappa live come fa
 *              il pannello - cosi' la mappa incorporata funziona anche da qui.
 *
 * Si passa da un modo all'altro quando il pannello comincia o smette: una
 * persona sola non deve comparire due volte nella stanza.
 */
(function () {
  "use strict";
  var S = window.Sito, C = window.OwlChat, L = S.L, el = S.el;
  var $ = function (id) { return document.getElementById(id); };
  var PREF = "gen3pm.chat.pref", PREF_PICCOLA = "gen3pm.chat.piccola";
  var Orologio = window.Battito || window;

  var stanza = 0, cfg = null, soloGuarda = false, peerMio = 0;
  var ses = null, ui = null;
  var bridge = null, link = null;
  var modo = "attesa";            // "attesa" | "ospite" | "autonomo" | "senzarelay"
  var elenco = null;              // l'ultimo elenco delle stanze aperte
  var canalePos = null;
  var mappaPronta = false, mappaInAttesa = null;
  var piccola = null;

  function prefs() { return S.pref(PREF, { suono: true, soloMenzioni: true, eventi: true }); }
  function memoria() { try { sessionStorage.getItem("x"); return sessionStorage; } catch (e) { return null; } }

  /* --- chi porta la stanza ---------------------------------------------- */
  function statoPannello() {
    var m = ses && ses.statoRemoto;
    if (!m || m.tipo !== "pannello" || !m.stanzaStato || !m.stanzaStato.inPartita) return null;
    if (Date.now() - ses.portanteVisto > 4000) return null;
    return m.stanzaStato;
  }

  /* La stessa forma, da qualunque parte arrivi. */
  function vista() {
    var p = modo === "ospite" ? statoPannello() : null;
    if (p) {
      return { fonte: "pannello", gioco: !p.spettatore, spettatore: !!p.spettatore, peer: p.peer, peerGioco: p.peerGioco || 0,
               posIo: p.posIo, amici: p.amici || [], club: !!p.club, clubAmici: p.clubAmici || [], rtt: p.rtt,
               relayOk: !!p.relayOk, inviati: p.inviati || 0, ricevuti: p.ricevuti || 0 };
    }
    if (modo === "autonomo" && bridge) {
      var s = bridge.snapshot();
      return { fonte: "mia", gioco: false, spettatore: true, peer: peerMio, peerGioco: cfg.peerGioco || 0, posIo: null,
               amici: s.amici, club: false, clubAmici: s.clubAmici || [], rtt: s.rttUltimo, relayOk: !!(link && link.aperta),
               inviati: 0, ricevuti: s.received };
    }
    return { fonte: "niente", gioco: false, spettatore: false, peer: peerMio, peerGioco: 0, posIo: null, amici: [], club: false,
             clubAmici: [], rtt: null, relayOk: false, inviati: 0, ricevuti: 0 };
  }

  function posPerChat() {
    var v = vista(), p = v.posIo;
    if (!p && v.peerGioco) v.amici.forEach(function (a) { if (a.peerId === v.peerGioco) p = a.pos; });
    return p ? { g: p.gruppo, n: p.numero, x: p.x, y: p.y } : null;
  }

  function statoPerSchede() {
    var v = vista();
    return { inPartita: false, guarda: true, spettatore: true, stanza: stanza, peer: peerMio, peerGioco: cfg.peerGioco || 0,
             relayOk: v.relayOk, rtt: v.rtt, posIo: null, amici: v.amici, club: false, clubAmici: v.clubAmici };
  }

  function motivoSpento() {
    if (modo === "senzarelay") return L("Non c'è un relay nelle impostazioni: scrivilo nel Pannello → Impostazioni.", "There's no relay in the settings: enter it in Panel → Settings.");
    if (modo === "attesa") return L("Mi collego alla stanza…", "Connecting to the room…");
    if (modo === "ospite") return statoPannello() && !statoPannello().relayOk ? L("Il relay non risponde: la chat riparte da sola quando torna.", "The relay isn't answering: the chat resumes by itself when it's back.") : "";
    return (link && link.aperta) ? "" : L("Il relay non risponde: riprovo da solo, la chat riparte quando torna.", "The relay isn't answering: I keep retrying, the chat resumes when it's back.");
  }

  /* --- autonomo: spettatore col proprio collegamento ---------------------- */
  function autonomo() {
    if (modo === "autonomo") return;
    if (!cfg.relay) { modo = "senzarelay"; disegna(); return; }
    modo = "autonomo";
    var url = OwlRelay.normalizzaUrl(cfg.relay);
    url += (url.indexOf("?") >= 0 ? "&" : "?") + "stanza=" + stanza;
    ses.peer = peerMio; ses.nome = C.pulisci(cfg.nome || "", C.NOME_MAX); ses.ruolo = "s";
    var mioBridge = bridge = new OwlBridge({
      peerId: peerMio, room: stanza, device: null, spettatore: true, log: function () {},
      onStatus: function () { disegna(); }, onPos: pubblicaPosizioni,
      onChat: function (peer, corpo) { ses.ricevi(peer, corpo); },
      onAmico: function (cosa, peer) { ses.evento(cosa, peer, ses.nomeDi(peer)); disegna(); },
      onClub: function (cosa, peer) { if (cosa === "amico" || cosa === "amicofine") ses.evento(cosa, peer, ses.nomeDi(peer)); disegna(); },
      onNumeroOccupato: function () {
        // il numero di questa scheda lo usa un altro: se ne prende uno nuovo e si rientra
        peerMio = S.peerDiScheda([peerMio, cfg.peer, cfg.peerGioco]);
        smettiAutonomo(true);
        modo = "attesa";
        autonomo();
      }
    });
    var mioLink = link = new OwlRelay.RelayLink(url, {
      onMessage: function (b) { mioBridge.onRelayMessage(b); },
      onOpen: function () { mioBridge.sendHello(); ses.ciao(); disegna(); },
      onClose: function () { disegna(); },
      log: function () {}
    });
    bridge.link = link;
    link.connect();
    bridge.start();
    ses.diventaPortante(function (b) { return !!(bridge === mioBridge && mioLink.aperta && mioBridge.sendChat(b)); });
    ses.evento("ioguardo", 0, "", stanza);
    disegna();
  }

  function smettiAutonomo(senzaDire) {
    if (ses && ses.portante()) { if (senzaDire) ses.invia = null; else ses.diventaOspite(); }
    if (bridge) bridge.stop();
    if (link) link.close();
    bridge = null; link = null;
  }

  /* Chiamata al caricamento (dopo aver chiesto «c'e' qualcuno?») e a ogni
   * notizia dalle altre schede. */
  function decidi() {
    if (statoPannello()) {
      if (modo === "autonomo") smettiAutonomo(false);
      if (modo !== "ospite") { modo = "ospite"; }
    } else if (modo === "attesa" || modo === "ospite") {
      autonomo();
    }
    disegna();
  }

  /* --- le posizioni per la Mappa live (solo da autonomo) -------------------- */
  function inSecondi(p) {
    if (!p) return null;
    var o = {};
    for (var k in p) o[k] = p[k];
    o.t = (p.visto || Date.now()) / 1000;
    return o;
  }
  var ultimoInvioPos = 0, posInCoda = null;
  function pubblicaAdesso() {
    if (modo !== "autonomo" || !bridge || !canalePos) return;
    var s = bridge.snapshot(), amici = {}, ora = Date.now() / 1000, io = null, ioPeer = peerMio, nomi = {};
    s.amici.forEach(function (a) { amici[a.peerId] = inSecondi(a.pos); });
    // «tu» sei il tuo giocatore, se hai detto con che numero giochi (come nel pannello)
    if (cfg.peerGioco && amici[cfg.peerGioco]) { io = amici[cfg.peerGioco]; ioPeer = cfg.peerGioco; delete amici[cfg.peerGioco]; }
    for (var p in ses.nomi) if (ses.nomi[p].nome) nomi[p] = ses.nomi[p].nome;
    try { canalePos.postMessage({ t: ora, viste: [{ peer: ioPeer, t: ora, io: io, amici: amici, nomi: nomi, stanza: stanza }] }); } catch (e) { /* niente */ }
  }
  function pubblicaPosizioni() {
    var manca = 80 - (Date.now() - ultimoInvioPos);
    if (manca <= 0) { if (posInCoda) { clearTimeout(posInCoda); posInCoda = null; } ultimoInvioPos = Date.now(); pubblicaAdesso(); return; }
    if (posInCoda) return;
    posInCoda = setTimeout(function () { posInCoda = null; ultimoInvioPos = Date.now(); pubblicaAdesso(); }, manca);
  }

  /* --- la scheda «Mappa live» ------------------------------------------------- */
  function apriMappaDentro(pos) {
    var f = $("mappa-dentro");
    if (pos && mappaPronta) {
      try {
        var w = f.contentWindow;
        if (w && w.__mappa && w.__mappa.centra) { w.__mappa.centra(pos.g + "." + pos.n, pos.x, pos.y); return; }
      } catch (e) { /* si ricarica qui sotto */ }
    }
    if (!f.getAttribute("src") || pos) {
      mappaPronta = false;
      f.onload = function () { mappaPronta = true; pubblicaAdesso(); };
      f.src = pos ? S.urlMappa(pos, true) : "mappa.html?dentro=1";
    }
  }
  function suScheda(f) {
    var mappa = f === "mappa";
    $("riquadro-mappa").hidden = !mappa;
    $("chat-stanza").classList.toggle("solo-testa", mappa);
    if (mappa) { apriMappaDentro(mappaInAttesa); mappaInAttesa = null; disegnaPiccola(); }
  }
  /* «Mappa ↗» su una posizione condivisa: la scheda Mappa di questa pagina,
   * centrata li'. */
  function suPosizione(pos) {
    mappaInAttesa = pos;
    ui.scegliFiltro("mappa");
    return true;
  }

  /* --- la chat piccola ---------------------------------------------------------- */
  function disegnaPiccola() {
    var box = $("chat-piccola"), pill = $("chat-pillola");
    box.hidden = !!piccola.chiusa; pill.hidden = !piccola.chiusa;
    box.classList.toggle("bloccata", !!piccola.bloccata);
    box.classList.toggle("dx", piccola.lato === "dx"); pill.classList.toggle("dx", piccola.lato === "dx");
    var b = $("btn-blocca");
    b.setAttribute("aria-pressed", String(!!piccola.bloccata));
    b.textContent = piccola.bloccata ? L("Bloccata", "Locked") : L("Blocca", "Lock");
    var n = ses.store.messaggi().length;
    pill.textContent = "Chat · " + (n === 1 ? L("1 messaggio", "1 message") : n + L(" messaggi", " messages"));
    $("piccola-quale").textContent = L("stanza ", "room ") + stanza;
  }
  function cambiaPiccola(k, v) { piccola[k] = v; S.salvaPref(PREF_PICCOLA, piccola); disegnaPiccola(); }

  /* --- disegno ---------------------------------------------------------------- */
  function pillola(id, classe, testo) { $(id).className = "pillola" + (classe ? " " + classe : ""); $(id + "-testo").textContent = testo; }

  function disegna() {
    if (!ses) return;
    var v = vista();
    // intestazione
    if (modo === "senzarelay") pillola("pill-relay", "attesa", L("Relay non impostato", "Relay not set"));
    else if (v.fonte === "niente") pillola("pill-relay", "attesa", L("Relay: mi collego…", "Relay: connecting…"));
    else if (v.relayOk) pillola("pill-relay", "ok", "Relay" + (v.rtt !== null && v.rtt !== undefined ? " " + Math.round(v.rtt) + " ms" : ""));
    else pillola("pill-relay", "no", L("Relay non risponde", "Relay not answering"));
    if (v.gioco) pillola("pill-stato", "ok", v.club ? "Cable Club" : L("In partita", "In game"));
    else if (v.spettatore && v.relayOk) pillola("pill-stato", "", L("Spettatore", "Spectator"));
    else pillola("pill-stato", "", L("Non collegato", "Not connected"));

    // aperta o no (dall'elenco del relay)
    var inElenco = null;
    ((elenco && elenco.stanze) || []).forEach(function (s) { if (s.stanza === stanza) inElenco = s; });
    var badge = $("badge-aperta");
    badge.className = "targhetta" + (inElenco ? " aperta" : "");
    badge.textContent = inElenco ? L("Aperta · in elenco", "Open · on the list") : L("Fuori dall'elenco", "Off the list");

    // giocatori
    var modello = {
      ses: ses, posti: 4, conPeer: false, clubAmici: v.clubAmici,
      io: v.gioco ? { peer: v.peer, nome: ses.nomeDi(v.peer), pos: v.posIo, alClub: v.club }
                  : { spettatore: true, peer: v.peer, peerGioco: v.peerGioco },
      amici: v.amici.map(function (a) { return { peer: a.peerId, pos: a.pos }; })
    };
    var n = ChatUI.giocatori($("lista-giocatori"), modello);
    $("giocatori-conta").textContent = n + " / 4";

    // spettatori: io (se guardo) e quelli che si sono presentati in chat
    var ul = $("lista-spettatori"); ul.innerHTML = "";
    var spett = ses.spettatori().filter(function (s) { return s.peer !== v.peer; });
    var conta = spett.length + (v.spettatore && v.fonte !== "niente" ? 1 : 0);
    $("spett-titolo").textContent = L("Spettatori · ", "Spectators · ") + conta;
    function rigaSpett(nome, nota) {
      var li = el("li");
      li.appendChild(el("span", "avatar s grigio", S.iniziale(nome)));
      li.appendChild(el("span", "n", nome));
      li.appendChild(el("small", null, nota));
      ul.appendChild(li);
    }
    if (v.spettatore && v.fonte !== "niente") rigaSpett((ses.nome || "peer " + v.peer) + L(" (tu)", " (you)"), L("guardi", "watching"));
    spett.forEach(function (s) { rigaSpett(s.nome, L("guarda", "watching")); });
    if (!conta) ul.appendChild(el("li", "nessuno", L("Nessuno sta guardando.", "Nobody is watching.")));

    // il riquadro «Il tuo GBA»
    var cta = $("gba-cta"), pos = v.posIo, altrove = null;
    if (!pos && v.peerGioco) v.amici.forEach(function (a) { if (a.peerId === v.peerGioco) altrove = a.pos; });
    if (v.gioco) {
      $("gba-titolo").textContent = v.club ? L("Al Cable Club", "At the Cable Club") : L("In partita", "In game");
      $("gba-riga").textContent = v.club ? L("scambio o lotta in corso", "trade or battle in progress")
        : (pos ? S.nomeLuogo(pos.gruppo, pos.numero) + " " + S.coord(pos) + (S.cosaFa(pos) ? " · " + S.cosaFa(pos) : "") : L("cammina all'aperto: aspetto la posizione", "walk outdoors: waiting for the position"));
      $("gba-conti").textContent = "";
      [["↑ " + v.inviati], ["↓ " + v.ricevuti], [(v.rtt !== null && v.rtt !== undefined ? Math.round(v.rtt) + " ms" : "— ms")]].forEach(function (x) { $("gba-conti").appendChild(el("span", null, x[0])); });
      cta.hidden = true;
    } else {
      $("gba-conti").textContent = "";
      if (altrove) {
        $("gba-titolo").textContent = L("In partita (altrove)", "In game (elsewhere)");
        $("gba-riga").textContent = S.nomeLuogo(altrove.gruppo, altrove.numero) + " " + S.coord(altrove) + (S.cosaFa(altrove) ? " · " + S.cosaFa(altrove) : "");
        cta.hidden = true;
      } else {
        $("gba-titolo").textContent = modo === "senzarelay" ? L("Non collegato", "Not connected") : L("Stai guardando", "You're watching");
        $("gba-riga").textContent = modo === "senzarelay" ? L("manca il relay nelle impostazioni", "the relay is missing from the settings")
          : L("per comparire nel gioco degli altri serve il GBA, dal Pannello", "to show up in the others' game you need the GBA, from the Panel");
        cta.hidden = false;
        cta.textContent = modo === "senzarelay" ? L("Apri le impostazioni ›", "Open the settings ›") : L("Gioca dal Pannello ›", "Play from the Panel ›");
        cta.href = S.pagina("gioca", soloGuarda || modo === "senzarelay" ? "" : "stanza=" + stanza);
      }
    }

    // «adesso nella stanza»
    var box = $("adesso"); box.innerHTML = "";
    function voce(colore, nome, cosa, sotto) {
      var r = el("div", "voce"), pall = el("i"); pall.style.background = colore; r.appendChild(pall);
      var d = el("div"); d.appendChild(el("b", null, nome)); d.appendChild(document.createTextNode(" " + cosa));
      if (sotto) d.appendChild(el("small", null, sotto));
      r.appendChild(d); box.appendChild(r);
    }
    if (v.gioco && v.club) voce("#c46bd6", L("Tu", "You"), L("al Cable Club", "at the Cable Club"), L("scambio o lotta in corso · non toccare cavo e Pico", "trade or battle in progress · don't touch cable or Pico"));
    else if (v.gioco && pos) voce("#3a8fd9", L("Tu", "You"), S.cosaFa(pos), S.nomeLuogo(pos.gruppo, pos.numero) + " " + S.coord(pos));
    v.amici.forEach(function (a) {
      var nome = ses.nomeDi(a.peerId), tu = !v.gioco && v.peerGioco === a.peerId;
      if (v.clubAmici.indexOf(a.peerId) >= 0) voce("#c46bd6", nome, L("al Cable Club", "at the Cable Club"), L("scambio o lotta in corso", "trade or battle in progress"));
      else voce(tu ? "#3a8fd9" : ses.coloreDi(a.peerId), nome + (tu ? L(" (tu)", " (you)") : ""), S.cosaFa(a.pos), S.nomeLuogo(a.pos.gruppo, a.pos.numero) + " " + S.coord(a.pos));
    });
    if (!box.children.length) box.appendChild(el("div", "piccolo", L("Nessuno in gioco in questo momento. Chi entra comparirà qui.", "Nobody is in the game right now. Whoever joins will show up here.")));

    if (!$("riquadro-mappa").hidden) disegnaPiccola();
    if (ui) ui.aggiorna();
  }

  function leggiElenco() {
    S.elencoStanze(cfg.relay).then(function (d) { elenco = d.errore ? null : d; disegna(); });
  }

  /* --- avvio ---------------------------------------------------------------- */
  window.addEventListener("load", function () {
    cfg = S.cfg();
    var q = new URLSearchParams(location.search);
    soloGuarda = q.get("guarda") === "1";
    stanza = S.stanzaDaUrl() || cfg.stanza || 1;
    if (!S.stanzaDaUrl()) { try { history.replaceState(null, "", location.pathname + "?stanza=" + stanza); } catch (e) { /* niente */ } }
    S.ricordaUltima(stanza);
    peerMio = S.peerDiScheda([cfg.peer, cfg.peerGioco]);
    piccola = S.pref(PREF_PICCOLA, { bloccata: false, lato: "sx", chiusa: false });

    $("stanza-numero").textContent = stanza;
    document.title = L("Stanza ", "Room ") + stanza + " — gen3-poke-multiplayer";
    $("invito-url").textContent = S.urlInvito(stanza).replace(/^https?:\/\//, "");
    $("invito-url").title = S.urlInvito(stanza);
    $("nome-chat").value = cfg.nome || "";
    $("nav-pannello").href = S.pagina("gioca");

    ses = new C.Sessione({ stanza: stanza, peer: peerMio, nome: cfg.nome, ruolo: "s", tipo: "stanza", invia: null,
                           canale: C.apriCanale(), storage: memoria(), posMia: posPerChat, statoStanza: statoPerSchede });
    ui = ChatUI.monta($("chat-stanza"), {
      sessione: ses, stile: "piena", filtri: true, schedaMappa: true, rapide: true, posizione: true, contaNonLetti: true,
      nota: L("anche spettatori", "spectators too"), prefs: prefs, spento: motivoSpento,
      suScheda: suScheda, suPosizione: suPosizione
    });
    ChatUI.monta($("chat-piccola-corpo"), {
      sessione: ses, stile: "righe", titolo: null, prefs: prefs, spento: motivoSpento,
      segnaposto: L("Scrivi senza lasciare la mappa…", "Write without leaving the map…")
    });
    ChatUI.ascolta(ses, "onStato", function () { decidi(); });
    ChatUI.ascolta(ses, "onFine", function () { decidi(); });
    ChatUI.ascolta(ses, "onCambio", function () { if (!$("riquadro-mappa").hidden) disegnaPiccola(); });

    try {
      canalePos = new BroadcastChannel("gen3pm-posizioni");
      canalePos.onmessage = function (ev) { if (ev.data && ev.data.chiedo) pubblicaAdesso(); };
    } catch (e) { canalePos = null; }

    // i bottoni
    $("btn-invito").onclick = function () {
      var b = this;
      S.copia(S.urlInvito(stanza)).then(function (ok) { S.lampo(b, ok ? L("Copiato!", "Copied!") : L("Non ci riesco", "Couldn't copy")); });
    };
    $("btn-esci").onclick = function () {
      smettiAutonomo(false);
      ses.chiudi();
      location.href = S.pagina("stanze");
    };
    $("btn-blocca").onclick = function () { cambiaPiccola("bloccata", !piccola.bloccata); };
    $("btn-sposta").onclick = function () { cambiaPiccola("lato", piccola.lato === "dx" ? "sx" : "dx"); };
    $("btn-riduci").onclick = function () { cambiaPiccola("chiusa", true); };
    $("chat-pillola").onclick = function () { cambiaPiccola("chiusa", false); };
    Array.prototype.forEach.call(document.querySelectorAll("button[data-pref]"), function (b) {
      var k = b.getAttribute("data-pref");
      b.setAttribute("aria-pressed", String(!!prefs()[k]));
      b.onclick = function () {
        var p = prefs(); p[k] = !p[k]; S.salvaPref(PREF, p);
        b.setAttribute("aria-pressed", String(!!p[k]));
        if (k === "suono" && p[k]) S.suona();
        ui.aggiorna();
      };
    });
    $("form-nome").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var nome = C.pulisci($("nome-chat").value, C.NOME_MAX);
      $("nome-chat").value = nome;
      cfg.nome = nome;
      S.salva({ nome: nome });        // il pannello, se e' aperto, se ne accorge da solo
      if (modo === "autonomo") ses.setNome(nome);
      S.lampo(ev.target.querySelector("button"), L("Salvato", "Saved"));
      disegna();
    });
    window.addEventListener("storage", function () {
      var nuovo = S.cfg();
      if (nuovo.nome !== cfg.nome) { cfg.nome = nuovo.nome; if (document.activeElement !== $("nome-chat")) $("nome-chat").value = nuovo.nome; if (modo === "autonomo") ses.setNome(nuovo.nome); }
      cfg.peerGioco = nuovo.peerGioco;
    });

    S.caricaLuoghi().then(function () { disegna(); });
    disegna();
    // «C'e' un pannello che gioca in questa stanza?» Si aspetta la risposta
    // un attimo; se non arriva, ci si collega da soli.
    ses.chiedi();
    setTimeout(decidi, 700);

    Orologio.setInterval(function () {
      ses.battito();
      // il pannello ha smesso di parlare senza dirlo (scheda chiusa di colpo)
      if (modo === "ospite" && !statoPannello()) decidi();
    }, 1000);
    setInterval(disegna, 1000);
    leggiElenco();
    setInterval(function () { if (!document.hidden) leggiElenco(); }, 10000);

    window.addEventListener("beforeunload", function () { smettiAutonomo(false); ses.chiudi(); });
    window.__stanza = { modo: function () { return modo; }, ses: ses, vista: vista };
  });
})();
