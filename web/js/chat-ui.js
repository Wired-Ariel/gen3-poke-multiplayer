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

  /* LE EMOTE (2026-10-16, secondo giro): l'ordine e' quello di OwlChat.EMOTE
   * (il contratto con EVENT_EMOTE). Si disegnano come il riquadro del gioco,
   * mai con l'emoji: quella resta il `testo` del messaggio per i siti vecchi. */
  var EMO = [
    { sim: "!", nome: L("Sorpresa", "Surprise"), colore: "#d9463a" },
    { sim: "?", nome: L("Domanda", "Question"), colore: "#3a8fd9" },
    { sim: "♥", nome: L("Cuore", "Heart"), colore: "#e0457b" }
  ];
  function riquadroEmote(i, classe) {
    var e = el("span", "emo" + (classe ? " " + classe : ""), EMO[i].sim);
    e.style.color = EMO[i].colore;
    e.setAttribute("aria-hidden", "true");
    return e;
  }
  var AIUTO_EMOTE = L("Appare sopra il tuo personaggio, sul tuo GBA e su quello di chi ti ha a schermo.",
                      "It appears over your character, on your GBA and on the GBA of whoever has you on screen.");

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

  /* opts: {sessione, stile, filtri, schedaMappa, schedaSquadre, suScheda(id),
   *        rapide, emote, emoteSpente()->testo|"" (perche' le emote non
   *        partono: fuori partita), posizione, titolo, nota,
   *        prefs()->{suono,soloMenzioni,eventi}, suPosizione(pos),
   *        spento()->testo|"" (perche' non si puo' scrivere), segnaposto} */
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
        if (opts.schedaSquadre) voci.push(["squadre", L("Squadre", "Parties")]);
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
    // LE EMOTE (2026-10-16): il simbolo va in chat e, se chi lo manda ha un
    // avatar, compare sopra la sua testa nei giochi della stanza. Nella chat
    // grande una barra sopra il campo, col nome e una riga d'aiuto (che fa
    // anche da conto alla rovescia della pausa); nelle chat piccole tre tasti
    // quadrati accanto al campo, il nome nel `title`.
    var emote = null, emoteAiuto = null, emoteTasti = [], emoteTimer = null;
    if (opts.emote) {
      var piena = stile === "piena";
      emote = el("div", piena ? "chat-emote" : "chat-emote-mini");
      emote.setAttribute("role", "group");
      emote.setAttribute("aria-label", L("Emote nel gioco", "In-game emotes"));
      if (piena) {
        var testoBarra = el("div", "testo");
        testoBarra.appendChild(el("b", null, L("Nel gioco", "In game")));
        emoteAiuto = el("span", "aiuto", AIUTO_EMOTE);
        emoteAiuto.setAttribute("aria-live", "polite");
        testoBarra.appendChild(emoteAiuto);
        emote.appendChild(testoBarra);
      }
      var tasti = piena ? el("div", "tasti") : emote;
      EMO.forEach(function (e, i) {
        var b = el("button"); b.type = "button";
        b.appendChild(riquadroEmote(i));
        if (piena) b.appendChild(document.createTextNode(e.nome));
        b.title = e.nome;
        b.setAttribute("aria-label", e.nome + L(" sopra la tua testa, nel gioco", " over your head, in the game"));
        b.onclick = function () { manda("", { emote: i }); };
        tasti.appendChild(b);
        emoteTasti.push(b);
      });
      if (piena) { emote.appendChild(tasti); piede.appendChild(emote); }
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
    if (emote && stile !== "piena") riga.appendChild(emote);
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
      if (rispondo && !extra.pos && extra.emote === undefined) extra.rispondeA = rispondo;
      var r = ses.scrivi(testo, extra);
      if (extra.emote !== undefined) statoEmote();
      if (r.ok) {
        if (!extra.pos && extra.emote === undefined) campo.value = "";
        rispondo = null; boxRisposta.hidden = true;
        dico("");
        lista.scrollTop = lista.scrollHeight;
        return;
      }
      if (r.perche === "vuoto" || r.perche === "pausa") return;
      if (r.perche === "troppi") dico(L("Piano: al massimo 5 messaggi in 10 secondi. Riprova fra ", "Slow down: at most 5 messages every 10 seconds. Try again in ") + Math.ceil((r.attesa || 1000) / 1000) + " s.", true);
      else if (r.perche === "posizione") dico(L("La tua posizione non è ancora nota: serve il gioco avviato, all'aperto.", "Your position isn't known yet: the game must be running, outdoors."), true);
      else dico(L("Non sei collegato alla stanza: il messaggio non è partito.", "You're not connected to the room: the message wasn't sent."), true);
    }

    function scegliFiltro(f) {
      filtro = f;
      for (var k in bottoniFiltro) bottoniFiltro[k].setAttribute("aria-pressed", String(k === f));
      // le schede che non sono la chat (la Mappa live, le squadre) la nascondono
      var altrove = f === "mappa" || f === "squadre";
      lista.hidden = altrove; scrive.hidden = true; piede.hidden = altrove;
      if (opts.suScheda) opts.suScheda(f);
      sporco = true; ultimoNumero = -1; disegna();
      if (!altrove) lista.scrollTop = lista.scrollHeight;
    }

    /* I tasti delle emote: spenti fuori partita (o a chat spenta) e per i 2 s
     * della pausa, col conto alla rovescia nella riga d'aiuto. Durante la
     * pausa si ridisegna da solo; finita, si ferma. */
    function statoEmote() {
      if (!emote) return;
      clearTimeout(emoteTimer); emoteTimer = null;
      var chatSpenta = opts.spento ? !!opts.spento() : false;
      var fuori = (opts.emoteSpente ? opts.emoteSpente() : "") || "";
      var pausa = ses.pausaEmote ? ses.pausaEmote() : 0;
      var spente = chatSpenta || !!fuori;
      emote.classList.toggle("spenta", spente);
      emote.classList.toggle("in-pausa", !spente && pausa > 0);
      var aiuto = AIUTO_EMOTE, titolo = null;
      if (spente) aiuto = titolo = fuori || L("Le emote partono quando la chat è collegata.", "Emotes go out when the chat is connected.");
      else if (pausa > 0) {
        aiuto = titolo = L("Partita. Puoi mandarne un'altra fra ", "Sent. You can send another one in ") + Math.ceil(pausa / 1000) + " s.";
        emoteTimer = setTimeout(statoEmote, Math.min(250, pausa + 20));
      }
      if (emoteAiuto && emoteAiuto.textContent !== aiuto) emoteAiuto.textContent = aiuto;
      emoteTasti.forEach(function (b, i) {
        b.disabled = spente || pausa > 0;
        b.title = titolo || EMO[i].nome;
      });
    }

    function statoCampo() {
      var motivo = opts.spento ? opts.spento() : "";
      var spento = !!motivo;
      campo.disabled = spento; bManda.disabled = spento;
      if (bPos) bPos.disabled = spento;
      if (rapide) Array.prototype.forEach.call(rapide.children, function (b) { b.disabled = spento; });
      statoEmote();
      campo.placeholder = spento ? L("La chat è spenta", "Chat is off")
        : (opts.segnaposto || (L("Scrivi alla stanza ", "Write to room ") + ses.stanza + "…" + (stile === "piena" ? L("  (usa @ per chiamare qualcuno)", "  (use @ to call someone)") : "")));
      if (spento) { avviso.textContent = motivo; avviso.hidden = false; avviso.className = "chat-avviso"; }
      else if (avviso.className === "chat-avviso") { avviso.hidden = true; }
    }

    /* Un'emote non e' una bolla di testo: il riquadro del gioco, il nome, e
     * una nota con quello che e' successo nel gioco quando e' arrivata
     * (v.inGioco, scritto da chat.js con l'esito di bridge.emoteDi: per ora
     * vale quello del momento, non si aggiorna dopo). */
    function bollaEmote(v, mio, nome) {
      var b = el("div", "bolla emote" + (mio ? " mia" : ""));
      b.appendChild(riquadroEmote(v.emote));
      var cosa = el("div", "cosa");
      cosa.appendChild(el("b", null, EMO[v.emote].nome));
      var nota = el("span", "nota"), dot = el("i"), testo, colore;
      if (mio) { testo = L("sopra di te nel gioco", "over you in the game"); colore = null; }
      else if (v.inGioco === true) { testo = L("sopra ", "over ") + nome + L(" nel tuo gioco", " in your game"); colore = "#16a06e"; }
      else if (v.inGioco === false) { testo = nome + L(" è su un'altra mappa: solo in chat", " is on another map: chat only"); colore = "#b9b2a2"; }
      else { testo = L("sopra ", "over ") + nome + L(", nel gioco di chi l'ha a schermo", ", in the game of whoever has them on screen"); colore = "#b9b2a2"; }
      if (colore) { dot.style.background = colore; nota.appendChild(dot); }
      nota.appendChild(document.createTextNode(testo));
      cosa.appendChild(nota);
      b.appendChild(cosa);
      return b;
    }

    function bolla(v, mio, nome) {
      if (v.emote !== undefined && EMO[v.emote] && !v.pos) return bollaEmote(v, mio, nome);
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
          if (v.emote !== undefined && EMO[v.emote] && !v.pos) {
            var em = riquadroEmote(v.emote, "mini");
            em.removeAttribute("aria-hidden"); em.title = EMO[v.emote].nome;
            em.setAttribute("role", "img"); em.setAttribute("aria-label", EMO[v.emote].nome);
            r.appendChild(em);
          } else {
            r.appendChild(document.createTextNode(v.pos ? ("◎ " + S.nomeLuogo(v.pos.g, v.pos.n) + " " + S.coord(v.pos) + (v.testo ? " · " + v.testo : "")) : v.testo));
          }
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
          m.appendChild(bolla(v, true, ""));
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
        corpo.appendChild(bolla(v, false, nome));
        var br = el("button", "rispondi", L("Rispondi", "Reply")); br.type = "button";
        br.onclick = function () {
          rispondo = { id: v.id, nome: nome, testo: v.pos && !v.testo ? ("◎ " + S.nomeLuogo(v.pos.g, v.pos.n))
                       : (v.emote !== undefined && EMO[v.emote] ? EMO[v.emote].sim + " " + EMO[v.emote].nome : v.testo) };
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
      if (filtro === "mappa" || filtro === "squadre") return;
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

  /* --- LE SQUADRE (2026-10-16) ------------------------------------------------
   * Arrivano da bridge.js: `squadra` dalla scheda allenatore (squadraDaScheda:
   * specie, livello, cromatico, esausto, uovo), `dettagli` dagli EVENT_PARTY
   * (dettagliDaRecord: soprannome, sesso, PS, stato, natura, strumento, mosse),
   * `vista` = la parte della scheda con la squadra e' arrivata tutta. La
   * privacy di un altro si legge da cio' che arriva, perche' il filtro sta nel
   * SUO client e da lui parte solo quello che ha scelto:
   *   squadra e dettagli           -> "tutta"
   *   squadra senza dettagli       -> "base"   (i dettagli non partono)
   *   scheda arrivata, squadra no  -> "niente" (i byte della squadra sono a zero)
   *   scheda non ancora arrivata   -> "attesa"
   * La MIA la vedo sempre per intero (`mia`): il filtro sta fra il mio bridge e
   * il relay, non fra il bridge e questa pagina.
   * Sprite, tipi e nomi stanno in mappa/specie.json e mappa/squadra.json:
   * finche' non sono arrivati (o se il sito e' pubblicato senza i dati della
   * mappa) restano i numeri, e tutto si ridisegna da solo al giro dopo. */
  var STATI = [[0x07, "Addormentato", "Asleep"], [0x08, "Avvelenato", "Poisoned"], [0x10, "Scottato", "Burned"],
               [0x20, "Congelato", "Frozen"], [0x40, "Paralizzato", "Paralyzed"], [0x80, "Gravemente avvelenato", "Badly poisoned"]];
  function nomeStato(s) {
    for (var i = 0; i < STATI.length; i++) if (s & STATI[i][0]) return L(STATI[i][1], STATI[i][2]);
    return "";
  }
  function privacyDi(g) {
    if (!g.squadra || !g.squadra.length) return g.vista && !g.mia ? "niente" : "attesa";
    if (g.mia) return "tutta";
    return g.dettagli && g.dettagli.some(function (d) { return d; }) ? "tutta" : "base";
  }
  var PRIV_MIA = {
    tutta: L("Tu: mostri tutta la squadra", "You: you show your whole party"),
    base: L("Tu: mostri solo specie e livelli", "You: you show species and levels only"),
    niente: L("Tu: la tua squadra è nascosta", "You: your party is hidden")
  };
  function nomeSpecieMon(mon) { return mon.uovo ? L("Uovo", "Egg") : S.nomeSpecie(mon.specie); }
  /* Il soprannome, se c'e' e non e' il nome della specie. */
  function soprannome(mon, d) {
    if (!d || mon.uovo) return "";
    var s = S.testoGioco(d.soprannome);
    return s && s.toUpperCase() !== nomeSpecieMon(mon).toUpperCase() ? s : "";
  }
  function esausto(mon, d) { return !mon.uovo && (mon.ko || !!(d && d.psMax && d.ps === 0)); }
  function frazionePs(d) { return d && d.psMax ? Math.max(0, Math.min(1, d.ps / d.psMax)) : 0; }
  function barraPs(d, classe) {
    var barra = el("span", "barra-ps" + (classe ? " " + classe : "")), pieno = el("i"), f = frazionePs(d);
    pieno.style.width = Math.round(f * 100) + "%";
    pieno.className = f > 0.5 ? "" : (f > 0.2 ? "meta" : "poco");
    barra.appendChild(pieno);
    barra.setAttribute("role", "img");
    barra.setAttribute("aria-label", L("PS ", "HP ") + d.ps + "/" + d.psMax);
    return barra;
  }
  /* Uno sprite a pixel netti, a misura intera. */
  function pixel(src, lato, alt) {
    var img = el("img"); img.src = src; img.alt = alt || ""; img.width = lato; img.height = lato;
    img.className = "pixel"; img.decoding = "async";
    return img;
  }
  /* Lo sprite grande: il frontale (64x64) se c'e', altrimenti l'icona (32x32). */
  function sprite(mon, lato) {
    var f = S.frontaleSpecie(mon.specie, mon.cromatico);
    if (f) return pixel(f, lato);
    var i = S.iconaSpecie(mon.specie);
    return i ? pixel(i, lato) : el("b", "senza", nomeSpecieMon(mon).slice(0, 4));
  }
  function sesso(d) {
    return d && d.sesso ? el("span", "sesso " + d.sesso, d.sesso === "f" ? "♀" : "♂") : null;
  }
  function etichetta(testo, classe) { return el("span", "etichetta-stato" + (classe ? " " + classe : ""), testo); }

  /* La fila dell'elenco: le icone del gioco, il livello sotto; cromatico =
   * stellina, esausto = grigio. */
  function filaSquadra(squadra) {
    var fila = el("div", "squadra-fila");
    squadra.forEach(function (mon) {
      var nome = nomeSpecieMon(mon);
      var box = el("span", "mon" + (mon.ko ? " ko" : "") + (mon.cromatico ? " cromatico" : ""));
      box.title = nome + (mon.uovo ? "" : " Lv. " + mon.lv) + (mon.cromatico ? L(" · cromatico", " · shiny") : "") + (mon.ko ? L(" · esausto", " · fainted") : "");
      var icona = S.iconaSpecie(mon.specie);
      if (icona) box.appendChild(pixel(icona, 32, nome));
      else box.appendChild(el("b", "senza", nome.slice(0, 4)));
      box.appendChild(el("small", null, mon.uovo ? "·" : String(mon.lv)));
      fila.appendChild(box);
    });
    return fila;
  }

  /* I DETTAGLI nel pannello (la colonna stretta): un riquadro che si apre e si
   * chiude. La pagina della stanza ha la scheda grande (schedaSquadra). La
   * lista si ridisegna molte volte al secondo: chi e' aperto lo si ricorda qui. */
  var dettagliAperti = {};
  function boxDettagli(peer, squadra, dettagli) {
    if (!dettagli || !dettagli.some(function (d) { return d; })) return null;
    var box = el("details", "squadra-dettagli");
    if (dettagliAperti[peer]) box.open = true;
    box.addEventListener("toggle", function () { dettagliAperti[peer] = box.open; });
    box.appendChild(el("summary", null, L("Dettagli della squadra", "Party details")));
    var lista = el("ul");
    squadra.forEach(function (mon, i) {
      var d = dettagli[i], li = el("li");
      var specie = nomeSpecieMon(mon);
      var icona = S.iconaSpecie(mon.specie);
      if (icona) li.appendChild(pixel(icona, 32));
      var testo = el("div", "testo");
      if (!d || mon.uovo) {
        testo.appendChild(el("b", null, specie + (mon.uovo ? "" : " · Lv. " + mon.lv)));
        if (!mon.uovo) testo.appendChild(el("span", "tenue", L("dettagli in arrivo…", "details on the way…")));
        li.appendChild(testo); lista.appendChild(li); return;
      }
      var sopr = soprannome(mon, d);
      var testa = el("b", null, sopr ? sopr + " (" + specie + ")" : specie);
      if (d.sesso) testa.appendChild(el("span", "sesso " + d.sesso, d.sesso === "f" ? " ♀" : " ♂"));
      testa.appendChild(document.createTextNode(" · Lv. " + d.lv));
      testo.appendChild(testa);
      var st = nomeStato(d.stato);
      var ps = el("div", "ps");
      ps.appendChild(barraPs(d));
      ps.appendChild(el("span", null, L("PS ", "HP ") + d.ps + "/" + d.psMax));
      if (st) ps.appendChild(el("span", "stato", st));
      testo.appendChild(ps);
      var info = [];
      if (d.natura !== null) info.push(L("Natura ", "Nature ") + S.nomeNatura(d.natura));
      info.push(d.strumento ? L("Tiene ", "Holds ") + S.nomeStrumento(d.strumento) : L("Nessuno strumento", "No held item"));
      testo.appendChild(el("span", "tenue", info.join(" · ")));
      var mosse = el("div", "mosse");
      d.mosse.forEach(function (n) { if (n) mosse.appendChild(el("span", null, S.nomeMossa(n))); });
      testo.appendChild(mosse);
      li.appendChild(testo);
      lista.appendChild(li);
    });
    box.appendChild(lista);
    return box;
  }

  /* L'elenco dei giocatori di una stanza.
   * m: {io: {peer, nome, pos, spettatore, alClub, squadra, dettagli}|null,
   *     amici: [{peer, pos, squadra, dettagli, vista}], posti, ses,
   *     clubAmici: [peer], conPeer (mostra il numero), stretti,
   *     privacy ("tutta"|"base"|"niente": la mia, per la nota sotto di me),
   *     scegli(peer) (le righe diventano bottoni: la pagina della stanza),
   *     scelto (il peer della scheda aperta)}
   * Ritorna quanti giocatori ha disegnato; in m.disegnati la lista dei
   * giocatori come li ha visti (la pagina ci prende quello scelto). */
  function giocatori(ul, m) {
    S.caricaSpecie();
    S.caricaNomiSquadra();
    var ses = m.ses, elenco = [];
    ul.innerHTML = "";
    ul.className = "giocatori" + (m.stretti ? " stretti" : "") + (m.scegli ? " si-sceglie" : "");
    function riga(g) {
      elenco.push(g);
      var li = el("li");
      var scheda = el(m.scegli ? "button" : "div", "gioc");
      if (m.scegli) {
        scheda.type = "button";
        scheda.setAttribute("aria-pressed", String(m.scelto === g.peer));
        scheda.title = L("Apri la squadra di ", "Open the party of ") + g.nome;
        scheda.onclick = function () { m.scegli(g.peer); };
      }
      var testa = el("div", "testa");
      var av = el("span", "avatar" + (m.stretti ? " m" : ""), S.iniziale(g.nome)); av.style.background = g.colore;
      var eta = g.pos && g.pos.visto ? (Date.now() - g.pos.visto) / 1000 : 999;
      av.appendChild(el("i", "vivo" + (eta > 15 ? " fermo" : "")));
      testa.appendChild(av);
      var chi = el("div", "chi");
      var b = el("b", null, g.nome + (g.io ? L(" (tu)", " (you)") : "") + " ");
      if (m.conPeer && g.nome !== "peer " + g.peer) b.appendChild(el("small", null, "peer " + g.peer));
      chi.appendChild(b);
      var dove = g.alClub ? L("al Cable Club", "at the Cable Club")
        : (g.pos ? (S.nomeLuogo(g.pos.gruppo, g.pos.numero) + " " + S.coord(g.pos) + (S.cosaFa(g.pos) ? " · " + S.cosaFa(g.pos) : ""))
                 : L("posizione non ancora nota", "position not known yet"));
      chi.appendChild(el("span", null, dove));
      testa.appendChild(chi);
      var pv = privacyDi(g), mostra = pv === "tutta" || pv === "base";
      // la mia squadra la vedo sempre, ma se e' «nascosta» gli altri no: niente conto
      if (mostra && !(g.mia && m.privacy === "niente")) testa.appendChild(el("span", "conta", g.squadra.length + "/6"));
      else if (g.pos && g.pos.visto) testa.appendChild(el("span", "eta", S.quantoFa(g.pos.visto)));
      scheda.appendChild(testa);
      if (mostra) scheda.appendChild(filaSquadra(g.squadra));
      var nota = null;
      if (g.mia && PRIV_MIA[m.privacy]) nota = el("span", "sq-nota mia", PRIV_MIA[m.privacy]);
      else if (!g.mia && pv === "base") nota = el("span", "sq-nota", L("Mostra solo specie e livelli", "Shows species and levels only"));
      else if (!g.mia && pv === "niente") nota = el("span", "sq-nota", L("Squadra nascosta", "Party hidden"));
      if (nota) { nota.insertBefore(el("i"), nota.firstChild); scheda.appendChild(nota); }
      if (mostra && !m.scegli) {
        var dt = boxDettagli(g.peer, g.squadra, g.dettagli);
        if (dt) scheda.appendChild(dt);
      }
      li.appendChild(scheda);
      ul.appendChild(li);
    }
    if (m.io && !m.io.spettatore) {
      riga({ peer: m.io.peer, nome: m.io.nome, colore: "#3a8fd9", pos: m.io.pos, io: true, mia: true, alClub: m.io.alClub,
             squadra: m.io.squadra, dettagli: m.io.dettagli, vista: false });
    }
    (m.amici || []).forEach(function (a) {
      var io = !!(m.io && m.io.spettatore && m.io.peerGioco === a.peer);
      riga({ peer: a.peer, nome: ses ? ses.nomeDi(a.peer) : "peer " + a.peer, colore: io ? "#3a8fd9" : (ses ? ses.coloreDi(a.peer) : "#f2733a"),
             pos: a.pos, io: io, mia: false, alClub: (m.clubAmici || []).indexOf(a.peer) >= 0,
             squadra: a.squadra, dettagli: a.dettagli, vista: !!a.vista });
    });
    var posti = m.posti || 4, liberi = Math.max(0, posti - elenco.length);
    if (liberi) {
      var li = el("li", "posto-libero", liberi === 1 ? L("1 posto libero", "1 free seat") : liberi + L(" posti liberi", " free seats"));
      ul.appendChild(li);
    }
    m.disegnati = elenco;
    return elenco.length;
  }

  /* --- la scheda della squadra (pagina della stanza, al centro) ---------------
   * g: uno dei giocatori di giocatori() (m.disegnati), oppure null. Si
   * ridisegna solo se qualcosa e' cambiato: la pagina la chiama ogni secondo,
   * e rifare il DOM a ogni giro toglierebbe il fuoco a chi naviga da tastiera. */
  var monScelto = {};
  function vuota(box, titolo, testo) {
    var v = el("div", "sq-vuota");
    v.appendChild(el("span", "segno", "–"));
    v.appendChild(el("b", null, titolo));
    v.appendChild(el("span", null, testo));
    box.appendChild(v);
  }
  function schedaSquadra(box, g) {
    S.caricaSpecie(); S.caricaNomiSquadra();
    var chiave = g ? (g.mia ? "io" : String(g.peer)) : "";
    var firma = JSON.stringify([chiave, g && g.nome, g && g.squadra, g && g.dettagli, g && g.vista,
                                monScelto[chiave], S.nomeSpecie(1), S.nomeMossa(1)]);
    if (box._firma === firma) return;
    box._firma = firma;
    var fuoco = document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute("data-i") : null;
    box.innerHTML = "";
    box.classList.add("sq-scheda");

    var pv = g ? privacyDi(g) : "attesa", sq = (g && g.squadra) || [];
    var testa = el("div", "sq-testa");
    testa.appendChild(el("h2", null, !g ? L("Squadre", "Parties") : (g.io ? L("La tua squadra", "Your party") : L("Squadra di ", "Party of ") + g.nome)));
    if (pv === "tutta" || pv === "base") {
      var ko = sq.filter(function (m) { return m.ko; }).length, uova = sq.filter(function (m) { return m.uovo; }).length;
      var meta = sq.length + " Pokémon";
      if (ko) meta += " · " + ko + (ko === 1 ? L(" esausto", " fainted") : L(" esausti", " fainted"));
      if (uova) meta += " · " + uova + (uova === 1 ? L(" uovo", " egg") : L(" uova", " eggs"));
      if (pv === "base") meta += L(" · solo specie e livelli", " · species and levels only");
      testa.appendChild(el("span", "meta", meta));
    }
    testa.appendChild(el("span", "fonte", L("dalla scheda allenatore", "from the trainer card")));
    box.appendChild(testa);

    if (!g) {
      vuota(box, L("Nessuno in partita", "Nobody is playing"),
            L("Le squadre compaiono qui quando qualcuno gioca nella stanza: clicca un allenatore a sinistra.",
              "Parties show up here when someone plays in the room: click a trainer on the left."));
      return;
    }
    if (pv === "attesa") {
      if (g.mia) vuota(box, L("La tua squadra sta arrivando", "Your party is on its way"),
                       L("Compare appena il gioco manda la scheda allenatore: serve la partita avviata, in giro per la mappa.",
                         "It shows up as soon as the game sends the trainer card: the game must be running, out on the map."));
      else vuota(box, L("La squadra sta arrivando", "The party is on its way"),
                 L("La scheda allenatore di ", "The trainer card of ") + g.nome +
                 L(" arriva a pezzi insieme ai passi: qualche secondo e compare qui.", " comes in pieces along with the steps: give it a few seconds."));
      return;
    }
    if (pv === "niente") {
      vuota(box, L("Squadra nascosta", "Party hidden"),
            g.nome + L(" ha scelto di non mostrare la squadra nella stanza. Lo vedi comunque in chat e sulla Mappa live.",
                       " chose not to show their party in the room. You still see them in chat and on the Live map."));
      return;
    }

    var completa = pv === "tutta";
    var scelto = monScelto[chiave] || 0;
    if (scelto >= sq.length) scelto = 0;
    var griglia = el("div", "sq-griglia");
    sq.forEach(function (mon, i) {
      var d = completa && g.dettagli ? g.dettagli[i] : null, ko = esausto(mon, d);
      var nome = soprannome(mon, d) || nomeSpecieMon(mon);
      var c = el(completa ? "button" : "div", "sq-mon" + (completa && i === scelto ? " scelta" : "") + (ko ? " ko" : ""));
      if (completa) {
        c.type = "button";
        c.setAttribute("aria-pressed", String(i === scelto));
        c.setAttribute("data-i", String(i));
        c.onclick = function () { monScelto[chiave] = i; schedaSquadra(box, g); };
      }
      var alto = el("div", "alto");
      var foto = el("span", "foto");
      foto.appendChild(sprite(mon, 64));
      if (mon.cromatico) { var st = el("span", "stella", "★"); st.title = L("cromatico", "shiny"); foto.appendChild(st); }
      alto.appendChild(foto);
      var info = el("div", "info");
      var r1 = el("div", "nome");
      var bn = el("b", null, nome); bn.title = nome; r1.appendChild(bn);
      var sx = sesso(d); if (sx) r1.appendChild(sx);
      info.appendChild(r1);
      info.appendChild(el("span", "lv", mon.uovo ? L("si schiude camminando", "hatches as you walk")
        : (d ? "Lv. " + d.lv + " · " + d.ps + "/" + d.psMax : "Lv. " + mon.lv)));
      if (d && d.strumento) {
        var stru = el("span", "strumento"), ic = S.iconaStrumento(d.strumento);
        if (ic) stru.appendChild(pixel(ic, 24));
        stru.appendChild(el("span", null, S.nomeStrumento(d.strumento)));
        info.appendChild(stru);
      }
      alto.appendChild(info);
      c.appendChild(alto);
      var mezzo = el("div", "mezzo");
      if (!mon.uovo) S.tipiSpecie(mon.specie).forEach(function (t) { mezzo.appendChild(S.etichettaTipo(t, true)); });
      if (ko) mezzo.appendChild(etichetta(L("Esausto", "Fainted"), "ko"));
      else if (d && nomeStato(d.stato)) mezzo.appendChild(etichetta(nomeStato(d.stato)));
      c.appendChild(mezzo);
      if (d && !mon.uovo) c.appendChild(barraPs(d));
      griglia.appendChild(c);
    });
    box.appendChild(griglia);

    if (completa && sq[scelto]) box.appendChild(dettaglio(sq[scelto], g.dettagli ? g.dettagli[scelto] : null));
    if (pv === "base") {
      var avv = el("div", "sq-avviso");
      avv.appendChild(el("span", "i", "i"));
      avv.appendChild(el("span", null, g.nome + L(" mostra solo specie e livelli: PS, stato, natura, strumento e mosse restano sul suo GBA.",
                                                   " shows species and levels only: HP, status, nature, item and moves stay on their GBA.")));
      box.appendChild(avv);
    }
    if (fuoco !== null) { var f = box.querySelector('[data-i="' + fuoco + '"]'); if (f) f.focus(); }
  }

  function dettaglio(mon, d) {
    var box = el("div", "sq-dettaglio"), ko = esausto(mon, d);
    var sx = el("div", "sx");
    var cornice = el("span", "cornice" + (ko ? " ko" : ""));
    cornice.appendChild(sprite(mon, 128));
    if (mon.cromatico) cornice.appendChild(el("span", "cromatico", L("★ cromatico", "★ shiny")));
    sx.appendChild(cornice);
    var dex = S.numeroPokedex(mon.specie);
    if (dex && !mon.uovo) sx.appendChild(el("span", "dex", L("N. ", "No. ") + dex));
    var tipi = el("div", "tipi");
    if (!mon.uovo) S.tipiSpecie(mon.specie).forEach(function (t) { tipi.appendChild(S.etichettaTipo(t)); });
    sx.appendChild(tipi);
    box.appendChild(sx);

    var dx = el("div", "dx");
    var sopr = soprannome(mon, d), titolo = el("div", "titolo");
    titolo.appendChild(el("span", "nome", sopr || nomeSpecieMon(mon)));
    var ss = sesso(d); if (ss) titolo.appendChild(ss);
    if (!mon.uovo) titolo.appendChild(el("span", "lv", "Lv. " + (d ? d.lv : mon.lv)));
    var intesta = el("div");
    intesta.appendChild(titolo);
    if (sopr) intesta.appendChild(el("div", "sotto", nomeSpecieMon(mon)));
    dx.appendChild(intesta);
    if (mon.uovo) {
      dx.appendChild(el("p", "frase", L("Un Uovo nella squadra. Si schiude camminando: quando succede, qui compare il Pokémon nato.",
                                        "An Egg in the party. It hatches as you walk: when it does, the newborn Pokémon shows up here.")));
      box.appendChild(dx);
      return box;
    }
    if (!d) {
      dx.appendChild(el("p", "frase", L("Dettagli in arrivo…", "Details on the way…")));
      box.appendChild(dx);
      return box;
    }
    var ps = el("div", "ps");
    ps.appendChild(el("span", "sigla", L("PS", "HP")));
    ps.appendChild(barraPs(d, "grande"));
    ps.appendChild(el("span", "num", d.ps + " / " + d.psMax));
    if (ko) ps.appendChild(etichetta(L("Esausto", "Fainted"), "ko"));
    else if (nomeStato(d.stato)) ps.appendChild(etichetta(nomeStato(d.stato)));
    dx.appendChild(ps);
    var due = el("div", "due");
    var nat = el("div", "casella");
    nat.appendChild(el("small", null, L("Natura", "Nature")));
    nat.appendChild(el("b", null, d.natura !== null ? S.nomeNatura(d.natura) : "—"));
    due.appendChild(nat);
    var stru = el("div", "casella"), bs = el("b");
    stru.appendChild(el("small", null, L("Strumento", "Held item")));
    if (d.strumento) {
      var ic = S.iconaStrumento(d.strumento);
      if (ic) bs.appendChild(pixel(ic, 24));
      bs.appendChild(document.createTextNode(S.nomeStrumento(d.strumento)));
    } else bs.textContent = L("Nessuno", "None");
    stru.appendChild(bs);
    due.appendChild(stru);
    dx.appendChild(due);
    var mosse = el("div", "mosse");
    mosse.appendChild(el("small", null, L("Mosse", "Moves")));
    var gm = el("div", "griglia-mosse");
    d.mosse.forEach(function (n) {
      if (!n) return;
      var t = S.tipoMossa(n) || S.tipo(0), nome = S.nomeMossa(n);
      var mv = el("span", "mossa"); mv.style.setProperty("--tc", t.colore); mv.title = nome + " · " + t.nome;
      mv.appendChild(S.etichettaTipo(t, true));
      mv.appendChild(el("span", "nome", nome));
      gm.appendChild(mv);
    });
    if (!gm.children.length) gm.appendChild(el("span", "tenue", "—"));
    mosse.appendChild(gm);
    dx.appendChild(mosse);
    box.appendChild(dx);
    return box;
  }

  /* --- la mia privacy: tre opzioni a pulsante (pagina della stanza) ----------
   * Lo stesso valore di cfg.squadra e del <select id="squadra-privacy"> del
   * pannello. scegli(valore) lo salva: chi ha il bridge lo applica. */
  var PRIVACY = [
    ["tutta", L("Tutta la squadra", "The whole party"), L("Specie, livelli, PS, stato, natura, strumento e mosse.", "Species, levels, HP, status, nature, item and moves.")],
    ["base", L("Solo specie e livelli", "Species and levels only"), L("Gli altri vedono le icone e i livelli, nient'altro.", "The others see the icons and the levels, nothing else.")],
    ["niente", L("Nascosta", "Hidden"), L("Della tua squadra non parte niente verso la stanza.", "Nothing of your party leaves for the room.")]
  ];
  function sceltaPrivacy(box, valore, scegli) {
    if (box._valore === valore && box.children.length) return;
    box._valore = valore;
    var fuoco = document.activeElement && box.contains(document.activeElement);
    box.innerHTML = "";
    box.className = "sq-privacy";
    box.setAttribute("role", "radiogroup");
    PRIVACY.forEach(function (p) {
      var b = el("button", "opzione"); b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(p[0] === valore));
      b.tabIndex = p[0] === valore ? 0 : -1;
      b.appendChild(el("span", "cerchio"));
      var t = el("span", "testo");
      t.appendChild(el("b", null, p[1]));
      t.appendChild(el("span", null, p[2]));
      b.appendChild(t);
      b.onclick = function () { scegli(p[0]); };
      b.onkeydown = function (ev) {
        var d = ev.key === "ArrowDown" || ev.key === "ArrowRight" ? 1 : (ev.key === "ArrowUp" || ev.key === "ArrowLeft" ? -1 : 0);
        if (!d) return;
        ev.preventDefault();
        var i = PRIVACY.findIndex(function (x) { return x[0] === valore; });
        scegli(PRIVACY[(i + d + PRIVACY.length) % PRIVACY.length][0]);
        var nuovo = box.querySelector('[aria-checked="true"]'); if (nuovo) nuovo.focus();
      };
      box.appendChild(b);
    });
    if (fuoco) { var s = box.querySelector('[aria-checked="true"]'); if (s) s.focus(); }
  }

  /* «Cosi' ti vedono»: la mia riga come arriva agli altri.
   * m: {nome, luogo, squadra, privacy, altri: [nomi], gioco} */
  function cosiTiVedono(box, m) {
    var firma = JSON.stringify([m.nome, m.luogo, m.squadra, m.privacy, m.altri, m.gioco, S.nomeSpecie(1)]);
    if (box._firma === firma) return;
    box._firma = firma;
    box.innerHTML = "";
    var altri = m.altri || [];
    box.appendChild(el("p", "etichetta", altri.length
      ? L("Così ti vedono ", "How ") + (altri.length === 1 ? altri[0] : altri.slice(0, -1).join(", ") + L(" e ", " and ") + altri[altri.length - 1]) +
        L("", altri.length === 1 ? " sees you" : " see you")
      : L("Così ti vedono gli altri", "How the others see you")));
    var riga = el("div", "riga");
    var av = el("span", "avatar m", S.iniziale(m.nome)); av.style.background = "#3a8fd9";
    riga.appendChild(av);
    var chi = el("div", "chi");
    chi.appendChild(el("b", null, m.nome));
    chi.appendChild(el("span", null, m.luogo || "—"));
    riga.appendChild(chi);
    box.appendChild(riga);
    if (!m.gioco) {
      box.appendChild(el("p", "frase", L("Adesso guardi soltanto: della tua squadra non parte niente. La scelta vale quando giochi dal Pannello.",
                                        "Right now you're only watching: nothing of your party goes out. The choice applies when you play from the Panel.")));
      return;
    }
    if (m.privacy !== "niente" && m.squadra && m.squadra.length) box.appendChild(filaSquadra(m.squadra));
    var frasi = {
      tutta: L("Cliccandoti vedono anche PS, stato, natura, strumento e mosse.", "Clicking on you they also see HP, status, nature, item and moves."),
      base: L("Vedono solo queste icone e i livelli.", "They only see these icons and the levels."),
      niente: L("Al posto delle icone vedono «Squadra nascosta».", "Instead of the icons they see «Party hidden».")
    };
    box.appendChild(el("p", "frase", frasi[m.privacy] || frasi.tutta));
  }

  root.ChatUI = { monta: monta, giocatori: giocatori, ascolta: ascolta, testoEvento: testoEvento,
                  schedaSquadra: schedaSquadra, sceltaPrivacy: sceltaPrivacy, cosiTiVedono: cosiTiVedono,
                  privacyDi: privacyDi, EMO: EMO };
})(window);
