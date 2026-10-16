/* sito.js - le cose che servono a PIU' di una pagina (2026-10-11).
 *
 * Lingua, impostazioni salvate (la stessa chiave di app.js: una pagina sola
 * le scrive tutte, le altre ne ritoccano un campo), i nomi dei luoghi per la
 * chat, l'elenco delle stanze aperte, gli appunti. Niente di tutto questo
 * apre connessioni da solo.
 *
 * Script classico, come il resto di web/js. Si carica PRIMA di app.js,
 * stanze.js e stanza.js.
 */
(function (root) {
  "use strict";

  var EN = document.documentElement.lang === "en";
  function L(it, en) { return EN ? en : it; }
  var CHIAVE = "gen3pm.web", CHIAVE_VECCHIA = "passotile.web", CHIAVE_ULTIMA = "gen3pm.ultima";
  var DEF = root.GEN3PM_DEFAULTS || {};

  /* Il nome del file di una pagina nella lingua giusta: pagina("stanza") ->
   * "stanza.html" o "stanza-en.html". mappa.html e' una sola per tutte e due. */
  function pagina(nome, query) {
    var f = nome === "mappa" ? "mappa.html" : (nome + (EN ? "-en" : "") + ".html");
    return f + (query ? "?" + query : "");
  }

  /* --- le impostazioni --------------------------------------------------- */
  function leggiSalvate() {
    try { return JSON.parse(localStorage.getItem(CHIAVE) || localStorage.getItem(CHIAVE_VECCHIA) || "{}") || {}; }
    catch (e) { return {}; }
  }
  /* Le impostazioni con i default: quello che vedrebbe il pannello. */
  function cfg() {
    var s = leggiSalvate();
    return {
      relay: s.relay || DEF.relay || "",
      stanza: s.stanza || DEF.stanza || 1,
      peer: s.peer || 0,
      peerGioco: s.peerGioco || 0,
      nome: typeof s.nome === "string" ? s.nome : "",
      aperta: !!s.aperta,
      // la privacy della squadra (2026-10-16): la stessa chiave del pannello
      squadra: s.squadra === "base" || s.squadra === "niente" ? s.squadra : "tutta"
    };
  }
  /* Ritocca alcuni campi lasciando gli altri come sono. */
  function salva(parziale) {
    var s = leggiSalvate();
    for (var k in parziale) s[k] = parziale[k];
    try { localStorage.setItem(CHIAVE, JSON.stringify(s)); return true; } catch (e) { return false; }
  }
  /* Un numero di peer per le pagine che non sono il pannello: la pagina della
   * stanza guarda da spettatore, e non deve usare ne' il numero del pannello
   * ne' quello con cui si gioca altrove. Vive quanto la scheda. */
  function peerDiScheda(evita) {
    var n = 0;
    try { n = parseInt(sessionStorage.getItem("gen3pm.peer-scheda"), 10) || 0; } catch (e) { n = 0; }
    while (!(n >= 1 && n <= 65000) || (evita && evita.indexOf(n) >= 0)) n = 1 + Math.floor(Math.random() * 65000);
    try { sessionStorage.setItem("gen3pm.peer-scheda", String(n)); } catch (e) { /* niente */ }
    return n;
  }
  function stanzaValida(v) { var n = parseInt(v, 10); return (String(v).trim() !== "" && /^\d+$/.test(String(v).trim()) && n >= 1 && n <= 65535) ? n : 0; }
  function stanzaDaUrl() {
    try { return stanzaValida(new URLSearchParams(location.search).get("stanza") || ""); } catch (e) { return 0; }
  }
  function ricordaUltima(stanza) {
    try { localStorage.setItem(CHIAVE_ULTIMA, JSON.stringify({ stanza: stanza, quando: Date.now() })); } catch (e) { /* niente */ }
  }
  function ultima() {
    try { var u = JSON.parse(localStorage.getItem(CHIAVE_ULTIMA) || "null"); return u && stanzaValida(u.stanza) ? u : null; } catch (e) { return null; }
  }
  /* L'invito: apre il pannello con la stanza gia' compilata. Senza -en: la
   * lingua la sceglie lingua.js per chi lo riceve. */
  function urlInvito(stanza) {
    return location.origin + location.pathname.replace(/[^\/]*$/, "") + "gioca.html?stanza=" + stanza;
  }

  /* --- i luoghi ------------------------------------------------------------
   * mappa/nomi.json: {"gruppo.numero": [inglese, italiano|null]}, scritto da
   * tools/gen_mappa.py. Se manca (il sito pubblicato senza i dati della
   * mappa), i luoghi si chiamano "mappa g.n": la chat funziona lo stesso. */
  var luoghi = null, luoghiChiesti = null, MAP_OFFSET = 7;
  function caricaLuoghi() {
    if (luoghiChiesti) return luoghiChiesti;
    luoghiChiesti = fetch("mappa/nomi.json").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) { luoghi = d; return d; }, function () { luoghi = null; return null; });
    return luoghiChiesti;
  }
  function nomeLuogo(g, n) {
    var v = luoghi && luoghi[g + "." + n];
    if (v) return (!EN && v[1]) ? v[1] : v[0];
    return L("mappa ", "map ") + g + "." + n;
  }
  /* --- le specie (2026-10-16) ------------------------------------------------
   * mappa/specie.json: [[nome, "icone/x.png"|null], ...] indicizzato col numero
   * di specie DEL GIOCO (quello che il payload scrive nella scheda: non e' il
   * numero del Pokedex nazionale), 412 = uovo. Scritto da tools/gen_mappa.py.
   * Chi lo usa prima che arrivi vede "#123": la pagina ridisegna da sola. */
  var specie = null, specieChieste = null;
  function caricaSpecie() {
    if (specieChieste) return specieChieste;
    specieChieste = fetch("mappa/specie.json").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) { specie = d; return d; }, function () { specie = null; return null; });
    return specieChieste;
  }
  function nomeSpecie(n) { var v = specie && specie[n]; return v ? v[0] : "#" + n; }

  /* mappa/squadra.json (2026-10-16): i nomi per i DETTAGLI della squadra -
   * mosse e strumenti per numero, le 25 nature, e la tabella dei caratteri del
   * gioco per i soprannomi. Coppie [inglese, italiano|null]: l'italiano e'
   * quello letto dalla cartuccia, dove manca vale l'inglese. */
  var nomiSq = null, nomiSqChiesti = null;
  function caricaNomiSquadra() {
    if (nomiSqChiesti) return nomiSqChiesti;
    nomiSqChiesti = fetch("mappa/squadra.json").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) { nomiSq = d; return d; }, function () { nomiSq = null; return null; });
    return nomiSqChiesti;
  }
  function coppia(v, ripiego) { return v ? ((!EN && v[1]) ? v[1] : v[0]) : ripiego; }
  function nomeMossa(n) { return coppia(nomiSq && nomiSq.mosse[n], "#" + n); }
  function nomeStrumento(n) { return coppia(nomiSq && nomiSq.strumenti[n], "#" + n); }
  function nomeNatura(n) { return coppia(nomiSq && nomiSq.nature[n], "#" + n); }
  /* I byte di un nome del gioco (0xFF = fine) -> testo. Senza tabella: "". */
  function testoGioco(b) {
    if (!nomiSq) return "";
    var s = "";
    for (var i = 0; i < b.length && b[i] !== 0xFF; i++) s += nomiSq.testo[b[i]] || "?";
    return s.trim();
  }
  function iconaSpecie(n) { var v = specie && specie[n]; return v && v[1] ? "mappa/" + v[1] : null; }

  /* --- la scheda della squadra (2026-10-16, secondo giro) ---------------------
   * specie.json: [nome, icona, tipi, "frontali/x.png"] - tipi coi NUMERI del
   * gioco (TYPE_*); il cromatico e' accanto, "frontali/x-shiny.png" (non
   * l'uovo). squadra.json: le mosse hanno il tipo come terzo campo, gli
   * strumenti il nome della loro icona in strumenti/. Nomi e colori dei tipi
   * stanno qui: sono 18 righe, non vale la pena di farli viaggiare. I nomi
   * italiani sono quelli che la cartuccia scrive per esteso (la sua tabella
   * dei tipi li accorcia a 6 lettere: «COLEOT», «SP.TRO»). Il 9 e' il «???»
   * di Maledizione: nessun Pokemon ce l'ha, una mossa si'. */
  var TIPI = [
    ["Normale", "Normal", "#a8a878"], ["Lotta", "Fighting", "#c03028"], ["Volante", "Flying", "#a890f0"],
    ["Veleno", "Poison", "#a040a0"], ["Terra", "Ground", "#c8a050"], ["Roccia", "Rock", "#b8a038"],
    ["Coleottero", "Bug", "#a8b820"], ["Spettro", "Ghost", "#705898"], ["Acciaio", "Steel", "#a0a0c0"],
    ["???", "???", "#68a090"], ["Fuoco", "Fire", "#f08030"], ["Acqua", "Water", "#6890f0"],
    ["Erba", "Grass", "#78c850"], ["Elettro", "Electric", "#e8b020"], ["Psico", "Psychic", "#f85888"],
    ["Ghiaccio", "Ice", "#78c8c8"], ["Drago", "Dragon", "#7038f8"], ["Buio", "Dark", "#705848"]
  ];
  function tipo(n) { var t = TIPI[n]; return t ? { n: n, nome: L(t[0], t[1]), colore: t[2] } : null; }
  function tipiSpecie(n) { var v = specie && specie[n]; return (v && v[2] ? v[2] : []).map(tipo).filter(Boolean); }
  /* Il numero del Pokedex NAZIONALE (quello che il gioco mostra), non quello
   * di specie: da Treecko in poi sono diversi. */
  function numeroPokedex(n) { var v = specie && specie[n]; return v && v[4] ? v[4] : null; }
  /* Lo sprite frontale 64x64; cromatico = la versione con shiny.pal. */
  function frontaleSpecie(n, cromatico) {
    var v = specie && specie[n];
    if (!v || !v[3]) return null;
    return "mappa/" + (cromatico && n !== 412 ? v[3].replace(/\.png$/, "-shiny.png") : v[3]);
  }
  function tipoMossa(n) { var v = nomiSq && nomiSq.mosse[n]; return v && typeof v[2] === "number" ? tipo(v[2]) : null; }
  function iconaStrumento(n) { var v = nomiSq && nomiSq.strumenti[n]; return v && v[2] ? "mappa/strumenti/" + v[2] + ".png" : null; }
  /* Un'etichetta di tipo: il colore del gioco, il bordo sotto piu' scuro (CSS). */
  function etichettaTipo(t, piccola) {
    var e = el("span", "tipo" + (piccola ? " piccola" : ""), t.nome);
    e.style.setProperty("--tc", t.colore);
    return e;
  }

  /* Le coordinate come le mostra la Mappa live: senza il bordo di 7 tile. */
  function coord(pos) { return "(" + (pos.x - MAP_OFFSET) + "," + (pos.y - MAP_OFFSET) + ")"; }
  function urlMappa(pos, incorporata) {
    return "mappa.html?mappa=" + pos.g + "." + pos.n + "&x=" + pos.x + "&y=" + pos.y + (incorporata ? "&dentro=1" : "");
  }

  /* Che cosa sta facendo un giocatore, dalla sua ultima posizione (bridge.js,
   * _aggiornaPos): lo stato del gioco se non e' in giro, altrimenti come si
   * muove. avatarState: 1-2 bici, 3 surf, 4 sott'acqua, 6 pesca. */
  var STATI = {
    it: { 1: "in lotta", 2: "in un dialogo", 3: "nel menu", 4: "nella Borsa", 5: "nella Squadra", 6: "nel Pokédex", 7: "nel PokéNav" },
    en: { 1: "in battle", 2: "in a dialogue", 3: "in the menu", 4: "in the Bag", 5: "in the Party", 6: "in the Pokédex", 7: "in the PokéNav" }
  };
  function cosaFa(pos) {
    if (!pos) return "";
    if (pos.stato) return (EN ? STATI.en : STATI.it)[pos.stato] || "";
    if (pos.avatar === 1 || pos.avatar === 2) return L("in bici", "cycling");
    if (pos.avatar === 3) return L("fa surf", "surfing");
    if (pos.avatar === 4) return L("sott'acqua", "diving");
    if (pos.avatar === 6) return L("pesca", "fishing");
    return pos.speed === 1 ? L("corre", "running") : L("cammina", "walking");
  }
  function quantoFa(ms) {
    if (!ms) return "";
    var s = Math.round((Date.now() - ms) / 1000);
    if (s <= 2) return L("adesso", "now");
    if (s < 60) return s + " s";
    return Math.round(s / 60) + " min";
  }
  function iniziale(nome) {
    var m = /[A-Za-zÀ-ÿ0-9]/.exec(String(nome || "").replace(/^peer\s*/i, ""));
    return m ? m[0].toUpperCase() : "?";
  }

  /* --- le stanze aperte ------------------------------------------------------
   * L'elenco lo tiene relay.py e lo serve relay_ws.py su GET /ws?stanze: lo
   * stesso indirizzo del WebSocket, in http(s). */
  function urlStanze(relay) {
    var u = root.OwlRelay ? root.OwlRelay.normalizzaUrl(relay || "") : (relay || "");
    if (!u) return "";
    return u.split("?")[0].replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://") + "?stanze";
  }
  /* -> Promise di {stanze:[{stanza,giocatori,spettatori}], posti, ms, errore?} */
  function elencoStanze(relay) {
    var u = urlStanze(relay);
    if (!u) return Promise.resolve({ stanze: [], posti: 4, errore: "norelay" });
    var t0 = Date.now();
    return fetch(u, { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
      return { stanze: (d && d.stanze) || [], posti: (d && d.posti) || 4, ms: Date.now() - t0, errore: d && d.errore ? "muto" : null };
    }, function () { return { stanze: [], posti: 4, errore: "rete" }; });
  }

  /* --- varie ----------------------------------------------------------------- */
  function copia(testo) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(testo).then(function () { return true; }, function () { return copiaVecchia(testo); });
    }
    return Promise.resolve(copiaVecchia(testo));
  }
  function copiaVecchia(testo) {
    try {
      var ta = document.createElement("textarea"); ta.value = testo; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); document.body.removeChild(ta); return ok;
    } catch (e) { return false; }
  }
  /* Un bottone che per due secondi dice com'e' andata, poi torna com'era. */
  function lampo(bott, testo) {
    if (!bott) return;
    if (!bott.dataset.testo) bott.dataset.testo = bott.innerHTML;
    bott.textContent = testo;
    clearTimeout(bott._lampo);
    bott._lampo = setTimeout(function () { bott.innerHTML = bott.dataset.testo; }, 2000);
  }
  function el(tag, classe, testo) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined && testo !== null) e.textContent = testo;
    return e;
  }
  /* Le preferenze di una pagina (notifiche, chat piccola...): un oggetto in localStorage. */
  function pref(chiave, def) {
    var v = {};
    try { v = JSON.parse(localStorage.getItem(chiave) || "{}") || {}; } catch (e) { v = {}; }
    for (var k in def) if (!(k in v)) v[k] = def[k];
    return v;
  }
  function salvaPref(chiave, v) { try { localStorage.setItem(chiave, JSON.stringify(v)); } catch (e) { /* niente */ } }

  /* Un «bip» corto per le notifiche, fatto con WebAudio: nessun file da
   * servire. I browser lo lasciano suonare solo dopo un gesto dell'utente
   * sulla pagina; prima di allora tace, e va bene cosi'. */
  var audio = null;
  function suona() {
    try {
      var A = root.AudioContext || root.webkitAudioContext;
      if (!A) return;
      if (!audio) audio = new A();
      if (audio.state === "suspended") audio.resume();
      var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
      o.type = "sine"; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1175, t + 0.09);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.27);
    } catch (e) { /* niente audio: non e' un motivo per fermarsi */ }
  }

  root.Sito = {
    EN: EN, L: L, DEF: DEF, MAP_OFFSET: MAP_OFFSET, pagina: pagina,
    cfg: cfg, salva: salva, peerDiScheda: peerDiScheda, stanzaValida: stanzaValida, stanzaDaUrl: stanzaDaUrl,
    ricordaUltima: ricordaUltima, ultima: ultima, urlInvito: urlInvito,
    caricaLuoghi: caricaLuoghi, nomeLuogo: nomeLuogo, coord: coord, urlMappa: urlMappa,
    caricaSpecie: caricaSpecie, nomeSpecie: nomeSpecie, iconaSpecie: iconaSpecie,
    caricaNomiSquadra: caricaNomiSquadra, nomeMossa: nomeMossa, nomeStrumento: nomeStrumento,
    nomeNatura: nomeNatura, testoGioco: testoGioco,
    TIPI: TIPI, tipo: tipo, tipiSpecie: tipiSpecie, frontaleSpecie: frontaleSpecie, numeroPokedex: numeroPokedex, tipoMossa: tipoMossa,
    iconaStrumento: iconaStrumento, etichettaTipo: etichettaTipo,
    cosaFa: cosaFa, quantoFa: quantoFa, iniziale: iniziale,
    urlStanze: urlStanze, elencoStanze: elencoStanze,
    copia: copia, lampo: lampo, el: el, pref: pref, salvaPref: salvaPref, suona: suona
  };
})(window);
