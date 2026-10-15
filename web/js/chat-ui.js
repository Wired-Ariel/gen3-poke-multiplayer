/* chat-ui.js - il disegno della chat e dell'elenco dei giocatori (2026-10-11).
 *
 * La logica sta in chat.js (OwlChat.Sessione): qui si disegna e basta. Tre
 * stili della stessa chat:
 *   "piena"    la pagina della stanza: avatar, filtri, risposte, posizione,
 *              frasi rapide, «sta scrivendo»;
 *   "stretta"  la colonna del pannello: le stesse bolle, senza avatar;
 *   "righe"    dentro la mappa: «nome testo», una riga per messaggio.
 *
 * TUTTO il testo che arriva dalla rete entra nella pagina con textContent:
 * un messaggio non puo' diventare HTML.
 *
 * Dipende da Sito (sito.js) e OwlChat (chat.js).
 */
(function (root) {
  "use strict";
  var S = root.Sito, C = root.OwlChat, L = S.L, el = S.el;

  /* Piu' di un ascoltatore sulla stessa sessione (la chat grande e quella
   * piccola sulla mappa leggono la stessa). */
  function ascolta(ses, evento, fn) {
    var chiave = "_asc_" + evento;
    if (!ses[chiave]) {
      ses[chiave] = [];
      ses[evento] = function () { var a = arguments; ses[chiave].forEach(function (f) { try { f.apply(null, a); } catch (e) { /* un disegno rotto non ferma gli altri */ } }); };
    }
    ses[chiave].push(fn);
  }

  function testoEvento(v, ses) {
    var chi = (v.peer && ses.nomeDi(v.peer) !== "peer " + v.peer) ? ses.nomeDi(v.peer) : (v.nome || (v.peer ? "peer " + v.peer : ""));
    switch (v.genere) {
      case "entra": return chi + L(" è entrato in gioco", " joined the game");
      case "esce": return chi + L(" è uscito", " left");
      case "amico": return chi + L(" è al Cable Club", " is at the Cable Club");
      case "amicofine": return chi + L(" ha lasciato il Cable Club", " left the Cable Club");
      case "club": return L("Sei al Cable Club: scambio o lotta in corso", "You're at the Cable Club: trade or battle in progress");
      case "clubfine": return L("Cable Club: sessione finita", "Cable Club: session over");
      case "spett": return chi + L(" guarda la stanza", " is watching the room");
      case "spettvia": return chi + L(" non guarda più", " stopped watching");
      case "io": return L("Sei entrato nella stanza ", "You joined room ") + (v.altro || "");
      case "ioguardo": return L("Guardi la stanza ", "You're watching room ") + (v.altro || "");
      case "iovia": return L("Hai lasciato la stanza", "You left the room");
      default: return chi;
    }
  }
  function coloreEvento(v, ses) {
    if (v.genere === "amico" || v.genere === "amicofine" || v.genere === "club" || v.genere === "clubfine") return "#c46bd6";
    if (v.genere === "esce" || v.genere === "spettvia" || v.genere === "iovia") return "#a9afa8";
    if (v.genere === "spett") return "#8b9189";
    if (v.genere === "io" || v.genere === "ioguardo") return "#3a8fd9";
    return v.peer ? ses.coloreDi(v.peer) : "#16a06e";
  }
  function giorno(ms) {
    var d = new Date(ms), o = new Date();
    if (d.toDateString() === o.toDateString()) return L("Oggi", "Today");
    return d.toLocaleDateString(S.EN ? "en" : "it", { day: "numeric", month: "long" });
  }

  /* La scheda di una posizione condivisa. */
  function schedaPos(v, mio, opts) {
    var box = el("div", "pos-scheda");
    box.appendChild(el("span", "tile"));
    var dove = el("div", "dove");
    dove.appendChild(el("small", null, mio ? L("La tua posizione", "Your position") : L("Posizione", "Position")));
    dove.appendChild(el("b", null, S.nomeLuogo(v.pos.g, v.pos.n) + " "));
    dove.appendChild(el("span", null, S.coord(v.pos)));
    box.appendChild(dove);
    var a = el("a", null, L("Mappa ↗", "Map ↗"));
    a.href = S.urlMappa(v.pos); a.target = "gen3pm-mappa";
    a.title = L("Apre la Mappa live centrata lì", "Opens the Live map centred there");
    if (opts.suPosizione) a.onclick = function (ev) { if (opts.suPosizione(v.pos) !== false) ev.preventDefault(); };
    box.appendChild(a);
    return box;
  }

  /* opts: {sessione, stile, filtri, schedaMappa, suScheda(id), rapide,
   *        posizione, titolo, nota, prefs()->{suono,soloMenzioni,eventi},
   *        suPosizione(pos), spento()->testo|"" (perche' non si puo' scrivere),
   *        segnaposto} */
  function monta(radice, opts) {
    opts = opts || {};
    var ses = opts.sessione, stile = opts.stile || "piena";
    var filtro = "tutto", rispondo = null, sporco = true, ultimoNumero = -1, nonLetti = 0, titoloPagina = document.title;
    var prefs = opts.prefs || function () { return { suono: false, soloMenzioni: true, eventi: true }; };

    radice.innerHTML = "";
    radice.classList.add("chat");
    if (stile !== "piena") radice.classList.add(stile);

    // --- testa
    var testa = null, bottoniFiltro = {};
    if (opts.titolo !== null && stile !== "righe") {
      testa = el("div", "chat-testa");
      testa.appendChild(el("span", "titolo", opts.titolo || "Chat"));
      if (opts.filtri) {
        var gruppo = el("div", "schede-filtro");
        gruppo.setAttribute("role", "group");
        var voci = [["tutto", L("Tutto", "All")], ["messaggi", L("Messaggi", "Messages")], ["eventi", L("Eventi di gioco", "Game events")]];
        if (opts.schedaMappa) voci.push(["mappa", L("Mappa live", "Live map")]);
        voci.forEach(function (f) {
          var b = el("button", null, f[1]); b.type = "button";
          b.setAttribute("aria-pressed", String(f[0] === filtro));
          b.onclick = function () { scegliFiltro(f[0]); };
          bottoniFiltro[f[0]] = b; gruppo.appendChild(b);
        });
        testa.appendChild(gruppo);
      }
      if (opts.nota) testa.appendChild(el("span", "nota", opts.nota));
      radice.appendChild(testa);
    }

    // --- lista
    var lista = el("div", "chat-lista");
    lista.setAttribute("role", "log"); lista.setAttribute("aria-live", "polite");
    radice.appendChild(lista);
    var scrive = el("div", "chat-scrive"); scrive.hidden = true;
    if (stile !== "righe") radice.appendChild(scrive);

    // --- piede
    var piede = el("div", "chat-piede");
    var boxRisposta = el("div", "chat-risposta"); boxRisposta.hidden = true;
    var rChi = el("b"), rTesto = el("span"), rVia = el("button", null, "×");
    rVia.type = "button"; rVia.setAttribute("aria-label", L("Annulla la risposta", "Cancel the reply"));
    rVia.onclick = function () { rispondo = null; boxRisposta.hidden = true; campo.focus(); };
    boxRisposta.appendChild(rChi); boxRisposta.appendChild(rTesto); boxRisposta.appendChild(rVia);
    piede.appendChild(boxRisposta);

    var rapide = null;
    if (opts.rapide) {
      rapide = el("div", "chat-rapide");
      (S.EN ? C.FRASI.en : C.FRASI.it).forEach(function (f) {
        var b = el("button", null, f); b.type = "button";
        b.onclick = function () { manda(f); };
        rapide.appendChild(b);
      });
      piede.appendChild(rapide);
    }
    var riga = el("div", "chat-riga");
    var bPos = null;
    if (opts.posizione) {
      bPos = el("button", "pos"); bPos.type = "button";
      bPos.appendChild(document.createTextNode("◎"));
      var parola = el("span", "parola", " " + L("Posizione", "Position")); bPos.appendChild(parola);
      bPos.title = L("Condividi la tua posizione", "Share your position");
      bPos.setAttribute("aria-label", bPos.title);
      bPos.onclick = function () { manda("", { pos: true }); };
      riga.appendChild(bPos);
    }
    var campo = el("input"); campo.type = "text"; campo.maxLength = C.TESTO_MAX; campo.autocomplete = "off";
    campo.setAttribute("aria-label", L("Messaggio per la stanza", "Message for the room"));
    campo.enterKeyHint = "send";
    campo.onkeydown = function (ev) { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); manda(campo.value); } };
    campo.oninput = function () { if (campo.value.trim()) ses.staScrivendo(); };
    riga.appendChild(campo);
    var bManda = el("button", "manda", L("Invia", "Send")); bManda.type = "button";
    bManda.onclick = function () { manda(campo.value); };
    riga.appendChild(bManda);
    piede.appendChild(riga);
    var avviso = el("div", "chat-avviso"); avviso.hidden = true;
    piede.appendChild(avviso);
    radice.appendChild(piede);

    function dico(testo, male) {
      avviso.textContent = testo || ""; avviso.hidden = !testo;
      avviso.className = "chat-avviso" + (male ? " male" : "");
      clearTimeout(dico._t);
      if (testo && male) dico._t = setTimeout(function () { avviso.hidden = true; avviso.className = "chat-avviso"; statoCampo(); }, 5000);
    }

    function manda(testo, extra) {
      extra = extra || {};
      if (rispondo && !extra.pos) extra.rispondeA = rispondo;
      var r = ses.scrivi(testo, extra);
      if (r.ok) {
        if (!extra.pos) campo.value = "";
        rispondo = null; boxRisposta.hidden = true;
        dico("");
        lista.scrollTop = lista.scrollHeight;
        return;
      }
      if (r.perche === "vuoto") return;
      if (r.perche === "troppi") dico(L("Piano: al massimo 5 messaggi in 10 secondi. Riprova fra ", "Slow down: at most 5 messages every 10 seconds. Try again in ") + Math.ceil((r.attesa || 1000) / 1000) + " s.", true);
      else if (r.perche === "posizione") dico(L("La tua posizione non è ancora nota: serve il gioco avviato, all'aperto.", "Your position isn't known yet: the game must be running, outdoors."), true);
      else dico(L("Non sei collegato alla stanza: il messaggio non è partito.", "You're not connected to the room: the message wasn't sent."), true);
    }

    function scegliFiltro(f) {
      filtro = f;
      for (var k in bottoniFiltro) bottoniFiltro[k].setAttribute("aria-pressed", String(k === f));
      var mappa = f === "mappa";
      lista.hidden = mappa; scrive.hidden = true; piede.hidden = mappa;
      if (opts.suScheda) opts.suScheda(f);
      sporco = true; ultimoNumero = -1; disegna();
      if (!mappa) lista.scrollTop = lista.scrollHeight;
    }

    function statoCampo() {
      var motivo = opts.spento ? opts.spento() : "";
      var spento = !!motivo;
      campo.disabled = spento; bManda.disabled = spento;
      if (bPos) bPos.disabled = spento;
      if (rapide) Array.prototype.forEach.call(rapide.children, function (b) { b.disabled = spento; });
      campo.placeholder = spento ? L("La chat è spenta", "Chat is off")
        : (opts.segnaposto || (L("Scrivi alla stanza ", "Write to room ") + ses.stanza + "…" + (stile === "piena" ? L("  (usa @ per chiamare qualcuno)", "  (use @ to call someone)") : "")));
      if (spento) { avviso.textContent = motivo; avviso.hidden = false; avviso.className = "chat-avviso"; }
      else if (avviso.className === "chat-avviso") { avviso.hidden = true; }
    }

    function bolla(v, mio) {
      var b = el("div", "bolla" + (v.menzione ? " menzione" : ""));
      if (v.rispondeA) {
        var c = el("div", "cita");
        c.appendChild(el("b", null, (v.rispondeA.nome || "…") + " "));
        c.appendChild(document.createTextNode(v.rispondeA.testo || ""));
        b.appendChild(c);
      }
      if (v.pos) b.appendChild(schedaPos(v, mio, opts));
      if (v.testo) b.appendChild(el("span", null, v.testo));
      if (v.menzione) b.appendChild(el("div", "menzionato", L("ti ha menzionato", "mentioned you")));
      return b;
    }

    function disegnaRighe(viste) {
      viste.forEach(function (x) {
        var v = x.v, r;
        if (v.tipo === "ev") { r = el("div", "rigo ev", testoEvento(v, ses)); }
        else {
          r = el("div", "rigo" + (v.menzione ? " menzione" : ""));
          var b = el("b", null, (v.mio ? L("Tu", "You") : (ses.nomeDi(v.peer) !== "peer " + v.peer ? ses.nomeDi(v.peer) : v.nome)) + " ");
          b.style.color = v.mio ? "#3a8fd9" : ses.coloreDi(v.peer);
          r.appendChild(b);
          r.appendChild(document.createTextNode(v.pos ? ("◎ " + S.nomeLuogo(v.pos.g, v.pos.n) + " " + S.coord(v.pos) + (v.testo ? " · " + v.testo : "")) : v.testo));
        }
        lista.appendChild(r);
      });
    }

    function disegnaBolle(viste) {
      var giornoPrec = "";
      viste.forEach(function (x) {
        var v = x.v, g = giorno(v.q);
        if (g !== giornoPrec) { lista.appendChild(el("div", "chat-giorno", g)); giornoPrec = g; }
        if (v.tipo === "ev") {
          var e = el("div", "chat-ev");
          var pallino = el("i"); pallino.style.background = coloreEvento(v, ses); e.appendChild(pallino);
          e.appendChild(el("span", "testo", testoEvento(v, ses)));
          e.appendChild(el("time", null, C.oraDi(v.q)));
          lista.appendChild(e);
          return;
        }
        var m = el("div", "chat-msg" + (x.primo ? " primo" : "") + (v.mio ? " mio" : ""));
        if (v.mio) {
          if (x.primo) m.appendChild(el("div", "chi", L("Tu · ", "You · ") + C.oraDi(v.q)));
          m.appendChild(bolla(v, true));
          lista.appendChild(m);
          return;
        }
        var colore = ses.coloreDi(v.peer);
        var nome = ses.nomeDi(v.peer) !== "peer " + v.peer ? ses.nomeDi(v.peer) : (v.nome || "peer " + v.peer);
        if (x.primo) { var av = el("span", "avatar", S.iniziale(nome)); av.style.background = colore; m.appendChild(av); }
        else m.appendChild(el("span", "spazio"));
        var corpo = el("div", "corpo");
        if (x.primo) {
          var chi = el("div", "chi"); chi.style.color = colore;
          chi.appendChild(document.createTextNode(nome + " "));
          chi.appendChild(el("time", null, C.oraDi(v.q)));
          corpo.appendChild(chi);
        }
        corpo.appendChild(bolla(v, false));
        var br = el("button", "rispondi", L("Rispondi", "Reply")); br.type = "button";
        br.onclick = function () {
          rispondo = { id: v.id, nome: nome, testo: v.pos && !v.testo ? ("◎ " + S.nomeLuogo(v.pos.g, v.pos.n)) : v.testo };
          rChi.textContent = L("Rispondi a ", "Reply to ") + nome; rTesto.textContent = rispondo.testo;
          boxRisposta.hidden = false; campo.focus();
        };
        corpo.appendChild(br);
        m.appendChild(corpo);
        lista.appendChild(m);
      });
    }

    function disegna() {
      statoCampo();
      if (filtro === "mappa") return;
      // chi sta scrivendo
      if (stile !== "righe") {
        var chi = ses.chiScrive();
        scrive.hidden = !chi.length;
        if (chi.length) {
          scrive.innerHTML = "<span class='punti'><i></i><i></i><i></i></span>";
          scrive.appendChild(document.createTextNode(chi.length === 1 ? chi[0] + L(" sta scrivendo…", " is typing…")
            : chi.slice(0, 2).join(L(" e ", " and ")) + L(" stanno scrivendo…", " are typing…")));
        }
      }
      if (!sporco && ses.store.voci.length === ultimoNumero) return;
      sporco = false; ultimoNumero = ses.store.voci.length;
      var inFondo = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 60;
      var p = prefs();
      var viste = C.vista(ses.store.voci, filtro, p.eventi !== false);
      lista.innerHTML = "";
      if (!viste.length) {
        lista.appendChild(el("div", "chat-vuota", filtro === "eventi"
          ? L("Nessun evento di gioco ancora.", "No game events yet.")
          : L("Ancora nessun messaggio. Chi entra legge da questo momento in poi: il relay non tiene lo storico.",
              "No messages yet. Whoever joins reads from this moment on: the relay keeps no history.")));
      } else if (stile === "righe") disegnaRighe(viste);
      else disegnaBolle(viste);
      if (inFondo) lista.scrollTop = lista.scrollHeight;
    }

    ascolta(ses, "onCambio", function () { sporco = true; disegna(); });
    ascolta(ses, "onMessaggio", function (v) {
      var p = prefs();
      if (p.suono && (!p.soloMenzioni || v.menzione)) S.suona();
      if (opts.contaNonLetti && document.hidden) { nonLetti++; document.title = "(" + nonLetti + ") " + titoloPagina; }
    });
    if (opts.contaNonLetti) document.addEventListener("visibilitychange", function () { if (!document.hidden && nonLetti) { nonLetti = 0; document.title = titoloPagina; } });

    disegna();
    lista.scrollTop = lista.scrollHeight;
    return {
      aggiorna: function () { sporco = true; disegna(); },
      filtro: function () { return filtro; },
      scegliFiltro: scegliFiltro,
      fuoco: function () { campo.focus(); },
      radice: radice
    };
  }

  /* L'elenco dei giocatori di una stanza.
   * m: {io: {peer, nome, pos, spettatore, alClub}|null, amici: [{peer, pos}], posti, ses,
   *     clubAmici: [peer], conPeer (mostra il numero), stretti} */
  function giocatori(ul, m) {
    var ses = m.ses;
    ul.innerHTML = "";
    ul.className = "giocatori" + (m.stretti ? " stretti" : "");
    var n = 0;
    function riga(peer, nome, colore, pos, io, alClub) {
      var li = el("li");
      var av = el("span", "avatar" + (m.stretti ? " m" : ""), S.iniziale(nome)); av.style.background = colore;
      var eta = pos && pos.visto ? (Date.now() - pos.visto) / 1000 : 999;
      av.appendChild(el("i", "vivo" + (eta > 15 ? " fermo" : "")));
      li.appendChild(av);
      var chi = el("div", "chi");
      var b = el("b", null, nome + (io ? L(" (tu)", " (you)") : "") + " ");
      if (m.conPeer && nome !== "peer " + peer) b.appendChild(el("small", null, "peer " + peer));
      chi.appendChild(b);
      var dove = alClub ? L("al Cable Club", "at the Cable Club")
        : (pos ? (S.nomeLuogo(pos.gruppo, pos.numero) + " " + S.coord(pos) + (S.cosaFa(pos) ? " · " + S.cosaFa(pos) : ""))
               : L("posizione non ancora nota", "position not known yet"));
      chi.appendChild(el("span", null, dove));
      li.appendChild(chi);
      if (pos && pos.visto) li.appendChild(el("span", "eta", S.quantoFa(pos.visto)));
      ul.appendChild(li);
    }
    if (m.io && !m.io.spettatore) { n++; riga(m.io.peer, m.io.nome, "#3a8fd9", m.io.pos, true, m.io.alClub); }
    (m.amici || []).forEach(function (a) {
      n++;
      var io = m.io && m.io.spettatore && m.io.peerGioco === a.peer;
      riga(a.peer, ses ? ses.nomeDi(a.peer) : "peer " + a.peer, io ? "#3a8fd9" : (ses ? ses.coloreDi(a.peer) : "#f2733a"), a.pos, io,
           (m.clubAmici || []).indexOf(a.peer) >= 0);
    });
    var posti = m.posti || 4, liberi = Math.max(0, posti - n);
    if (liberi) {
      var li = el("li", "posto-libero", liberi === 1 ? L("1 posto libero", "1 free seat") : liberi + L(" posti liberi", " free seats"));
      ul.appendChild(li);
    }
    return n;
  }

  root.ChatUI = { monta: monta, giocatori: giocatori, ascolta: ascolta, testoEvento: testoEvento };
})(window);
