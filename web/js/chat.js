/* chat.js - la chat della stanza (2026-10-11). Niente DOM qui dentro: il
 * disegno sta in chat-ui.js, questo file si prova da solo (bridge_test.html).
 *
 * Tre pezzi:
 *
 *   1. IL CORPO DEI T_CHAT (pack / unpack / normalizza): JSON utf-8, gemello
 *      di net/protocol.py (chat_pack / chat_unpack) - si toccano insieme.
 *      Tre forme:
 *        messaggio  {"id","nome","testo","ts","rispondeA"?,"pos"?}
 *        scrive     {"scrive":true,"nome"}         «sta scrivendo...»
 *        ciao       {"ciao":1|0,"nome","ruolo"}    chi c'e' (1) o se ne va (0)
 *      Il «ciao» e' il modo in cui viaggia il NOME (il relay non inoltra gli
 *      HELLO e i 12 byte degli eventi sono del gioco), ed e' anche l'unico
 *      modo in cui uno spettatore si fa vedere dagli altri.
 *
 *   2. Store: gli ultimi 200 fra messaggi ed eventi di gioco di UNA stanza.
 *      Dedup sull'id (la consegna UDP puo' duplicare), ordine sul `ts` del
 *      mittente corretto con l'ora di arrivo (un orologio sbagliato non puo'
 *      mettere un messaggio nel futuro ne' in fondo alla storia), e copia in
 *      sessionStorage, per stanza. Il relay non tiene lo storico.
 *
 *   3. Sessione: la chat di una pagina. Sa scrivere e ricevere, tiene i nomi
 *      e chi sta scrivendo, applica il limite di 5 messaggi in 10 s (a chi
 *      scrive E a chi riceve: il relay conta solo i datagrammi), e parla con
 *      le altre schede dello stesso sito su un BroadcastChannel. Una scheda
 *      col relay collegato e' PORTANTE: risponde a chi chiede, pubblica cio'
 *      che arriva e spedisce per conto delle schede OSPITI, che non hanno un
 *      collegamento loro (la Mappa live, o la pagina della stanza quando il
 *      pannello sta gia' giocando in quella stanza).
 *
 * Script classico, come il resto di web/js.
 */
(function (root) {
  "use strict";

  var TESTO_MAX = 280, NOME_MAX = 16, CITA_MAX = 80, ID_MAX = 24, CORPO_MAX = 1200;
  var MSG_MAX = 5, MSG_FINESTRA_MS = 10000;       // messaggi per peer
  var SCRIVE_OGNI_MS = 3000, SCRIVE_DURA_MS = 4500;
  var CIAO_OGNI_MS = 10000, CIAO_RISPOSTA_MS = 2000, PRESENZA_SCADE_MS = 32000;
  var TENUTI = 200;
  var SCARTO_MAX_MS = 15000;                      // oltre, del `ts` non ci si fida
  var NOME_CANALE = "gen3pm-stanza";
  var FRASI = {
    it: ["Ci vediamo al Centro Pokémon", "Scambio?", "Lotta?", "Torno subito"],
    en: ["Meet at the Pokémon Center", "Trade?", "Battle?", "Be right back"]
  };

  var enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  var dec = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8", { fatal: true }) : null;

  /* --- il corpo ----------------------------------------------------------- */

  function taglia(s, max) {
    // Per CARATTERI (code point), come lo slicing di Python: un'emoji conta 1.
    if (s.length <= max) return s;
    var a = Array.from(s);
    return a.length > max ? a.slice(0, max).join("") : s;
  }
  function pulisci(t, max) {
    if (typeof t !== "string") return "";
    return taglia(t.replace(/[\u0000-\u001f\u007f]/g, " ").trim(), max);
  }
  function intero(v, lo, hi) { return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi; }

  /* Da un oggetto qualunque a una delle tre forme (con `tipo`), oppure null.
   * Ritorna un oggetto NUOVO con solo i campi previsti, puliti e tagliati. */
  function normalizza(d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    var nome = pulisci(d.nome, NOME_MAX);
    if (d.scrive === true) return { tipo: "scrive", nome: nome };
    if ("ciao" in d) return { tipo: "ciao", nome: nome, ciao: d.ciao ? 1 : 0, ruolo: d.ruolo === "s" ? "s" : "g" };
    var id = pulisci(d.id, ID_MAX), testo = pulisci(d.testo, TESTO_MAX);
    if (!id || typeof d.ts !== "number" || !isFinite(d.ts)) return null;
    var out = { tipo: "msg", id: id, nome: nome, testo: testo, ts: Math.trunc(d.ts) };
    var p = d.pos;
    if (p && typeof p === "object" && intero(p.g, 0, 255) && intero(p.n, 0, 255) &&
        intero(p.x, -32768, 32767) && intero(p.y, -32768, 32767)) {
      out.pos = { g: p.g, n: p.n, x: p.x, y: p.y };
    }
    var r = d.rispondeA;
    if (r && typeof r === "object") {
      var rid = pulisci(r.id, ID_MAX);
      if (rid) out.rispondeA = { id: rid, nome: pulisci(r.nome, NOME_MAX), testo: pulisci(r.testo, CITA_MAX) };
    }
    if (!testo && !out.pos) return null;
    return out;
  }

  /* Il corpo di un T_CHAT (Uint8Array), mai oltre CORPO_MAX; null se `d` non
   * e' una delle tre forme. */
  function pack(d) {
    var n = normalizza(d);
    if (!n || !enc) return null;
    var o;
    if (n.tipo === "scrive") o = { nome: n.nome, scrive: true };
    else if (n.tipo === "ciao") o = { nome: n.nome, ciao: n.ciao, ruolo: n.ruolo };
    else {
      o = { id: n.id, nome: n.nome, testo: n.testo, ts: n.ts };
      if (n.pos) o.pos = n.pos;
      if (n.rispondeA) o.rispondeA = n.rispondeA;
    }
    for (;;) {
      var b = enc.encode(JSON.stringify(o));
      if (b.length <= CORPO_MAX) return b;
      if (!o.testo) return null;
      var a = Array.from(o.testo);
      o.testo = a.slice(0, Math.max(0, a.length - 8)).join("");
    }
  }

  function unpack(bytes) {
    if (!bytes || !dec || bytes.length > CORPO_MAX) return null;
    var d;
    try { d = JSON.parse(dec.decode(bytes)); } catch (e) { return null; }
    return normalizza(d);
  }

  /* --- lo store ----------------------------------------------------------- */

  /* opts: {stanza, max, storage (getItem/setItem, o null), onCambio()} */
  function Store(opts) {
    opts = opts || {};
    this.stanza = opts.stanza || 0;
    this.max = opts.max || TENUTI;
    this.storage = opts.storage || null;
    this.chiave = "gen3pm.chat." + this.stanza;
    this.voci = [];
    this.perId = {};
    this.onCambio = opts.onCambio || null;
    this.doppi = 0;
    this._carica();
  }

  /* L'ORA A CUI SI ORDINA. Di norma e' il `ts` di chi ha scritto: due
   * messaggi partiti in ordine restano in ordine anche se la rete li
   * scambia. Ma l'orologio di un altro non e' il nostro: se il suo `ts` e'
   * nel nostro futuro, o piu' vecchio di 15 s (nessuna rete ci mette tanto:
   * e' un orologio indietro), si usa l'ora di arrivo. */
  Store.quando = function (ts, arrivo) {
    var scarto = arrivo - ts;
    return (scarto < 0 || scarto > SCARTO_MAX_MS) ? arrivo : ts;
  };

  Store.prototype._carica = function () {
    if (!this.storage) return;
    try {
      var a = JSON.parse(this.storage.getItem(this.chiave) || "[]");
      if (!Array.isArray(a)) return;
      for (var i = 0; i < a.length; i++) {
        var v = a[i];
        if (v && typeof v.id === "string" && !this.perId[v.id]) { this.voci.push(v); this.perId[v.id] = v; }
      }
      this.voci.sort(function (x, y) { return (x.q - y.q) || (x.arrivo - y.arrivo); });
      this._taglia();
    } catch (e) { /* storia illeggibile: si riparte vuoti */ }
  };
  Store.prototype._salva = function () {
    if (!this.storage) return;
    try { this.storage.setItem(this.chiave, JSON.stringify(this.voci)); } catch (e) { /* pieno o vietato: pazienza */ }
  };
  Store.prototype._taglia = function () {
    while (this.voci.length > this.max) { var v = this.voci.shift(); delete this.perId[v.id]; }
  };

  /* Ritorna "nuovo", "doppio" oppure "aggiornato" (lo stesso id arrivato da
   * un'altra scheda con l'informazione «e' mio» che a noi mancava). */
  Store.prototype.aggiungi = function (v) {
    if (!v || !v.id) return "doppio";
    var c = this.perId[v.id];
    if (c) {
      this.doppi++;
      if (v.mio && !c.mio) { c.mio = true; this._salva(); if (this.onCambio) this.onCambio(); return "aggiornato"; }
      return "doppio";
    }
    if (typeof v.arrivo !== "number") v.arrivo = Date.now();
    if (typeof v.q !== "number") v.q = Store.quando(typeof v.ts === "number" ? v.ts : v.arrivo, v.arrivo);
    var i = this.voci.length;
    while (i > 0 && (this.voci[i - 1].q > v.q)) i--;
    this.voci.splice(i, 0, v);
    this.perId[v.id] = v;
    this._taglia();
    this._salva();
    if (this.onCambio) this.onCambio();
    return "nuovo";
  };
  Store.prototype.svuota = function () {
    this.voci = []; this.perId = {};
    this._salva();
    if (this.onCambio) this.onCambio();
  };
  Store.prototype.messaggi = function () { return this.voci.filter(function (v) { return v.tipo === "msg"; }); };

  /* --- la vista: filtro e raggruppamento ---------------------------------- */

  /* filtro: "tutto" | "messaggi" | "eventi". Ritorna copie leggere con
   * `primo` (primo di una serie della stessa persona: li' vanno nome e ora). */
  function vista(voci, filtro, mostraEventi) {
    var out = [], prec = null;
    for (var i = 0; i < voci.length; i++) {
      var v = voci[i];
      if (v.tipo === "ev") {
        if (filtro === "messaggi" || (filtro !== "eventi" && mostraEventi === false)) continue;
      } else if (filtro === "eventi") continue;
      var primo = true;
      if (v.tipo === "msg" && prec && prec.tipo === "msg" && prec.peer === v.peer &&
          !!prec.mio === !!v.mio && (v.q - prec.q) < 5 * 60000) primo = false;
      out.push({ v: v, primo: primo });
      prec = v;
    }
    return out;
  }

  function menziona(testo, nome, peer) {
    if (!testo) return false;
    var t = testo.toLowerCase();
    if (nome && t.indexOf("@" + nome.toLowerCase()) >= 0) return true;
    return !!peer && new RegExp("@(peer ?)?" + peer + "(?![0-9])").test(t);
  }

  function oraDi(ms) {
    var d = new Date(ms);
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  /* --- la sessione -------------------------------------------------------- */

  var contatoreSchede = 0;

  /* opts: {stanza, peer, nome, ruolo ("g" gioca / "s" guarda), tipo
   *        ("pannello" | "stanza" | "mappa"), invia(bytes)->bool oppure null
   *        (scheda ospite), canale (BroadcastChannel o un finto; null = niente
   *        altre schede), storage, posMia()->{g,n,x,y}|null, statoStanza()->
   *        oggetto qualunque da pubblicare alle schede ospiti, now(), rand()} */
  function Sessione(opts) {
    opts = opts || {};
    var self = this;
    this.now = opts.now || function () { return Date.now(); };
    this.rand = opts.rand || Math.random;
    this.stanza = opts.stanza & 0xFFFF;
    this.peer = opts.peer & 0xFFFF;
    this.nome = pulisci(opts.nome || "", NOME_MAX);
    this.ruolo = opts.ruolo === "s" ? "s" : "g";
    this.tipo = opts.tipo || "stanza";
    this.invia = opts.invia || null;
    this.posMia = opts.posMia || function () { return null; };
    this.statoStanza = opts.statoStanza || function () { return null; };
    this.id = (this.now() % 1e9).toString(36) + "-" + (++contatoreSchede) + "-" + Math.floor(this.rand() * 1e6).toString(36);
    this.store = new Store({ stanza: this.stanza, storage: opts.storage || null,
                             onCambio: function () { if (self.onCambio) self.onCambio(); } });
    this.nomi = {};            // peer -> {nome, ruolo, visto}
    this.scrivono = {};        // peer -> scadenza (ms)
    this.tempiPeer = {};       // peer -> [arrivi degli ultimi messaggi]
    this.mieiTempi = [];
    this.colori = {};
    this.ultimoCiao = 0; this.ultimoCiaoRisposta = 0; this.ultimoScrive = 0;
    this.ricevuti = 0; this.frenati = 0; this.illeggibili = 0; this.inviati = 0; this.nonInviati = 0;
    // la scheda portante che stiamo seguendo da ospiti
    this.portanteId = null; this.portanteVisto = 0; this.statoRemoto = null;
    // callback della pagina
    this.onCambio = null;      // la lista e' cambiata (o chi scrive, o i nomi)
    this.onMessaggio = null;   // (voce) un messaggio NUOVO di un altro
    this.onStato = null;       // (stato) dalla scheda portante
    this.onFine = null;        // la scheda portante ha chiuso
    this.canale = opts.canale || null;
    if (this.canale) this.canale.onmessage = function (ev) { self._dalCanale(ev && ev.data); };
  }

  Sessione.prototype.portante = function () { return !!this.invia; };
  Sessione.prototype._avvisa = function () { if (this.onCambio) this.onCambio(); };
  Sessione.prototype._posta = function (m) {
    if (!this.canale) return;
    m.da = this.id; m.stanza = this.stanza;
    try { this.canale.postMessage(m); } catch (e) { /* canale chiuso o messaggio non clonabile */ }
  };

  Sessione.prototype.nomeDi = function (peer) {
    if (peer === this.peer) return this.nome || ("peer " + peer);
    var n = this.nomi[peer];
    return (n && n.nome) || ("peer " + peer);
  };
  /* Tu azzurro; gli altri arancio, verde, viola, nell'ordine in cui si
   * presentano (poi si ricomincia). */
  var TAVOLOZZA = ["#f2733a", "#12a06e", "#c46bd6", "#d39a12", "#2f9aa8", "#b3566b"];
  Sessione.prototype.coloreDi = function (peer) {
    if (peer === this.peer) return "#3a8fd9";
    if (!this.colori[peer]) {
      var usati = 0; for (var k in this.colori) usati++;
      this.colori[peer] = TAVOLOZZA[usati % TAVOLOZZA.length];
    }
    return this.colori[peer];
  };
  Sessione.prototype._notaNome = function (peer, nome, ruolo) {
    var n = this.nomi[peer], nuovo = !n, cambiato = false;
    if (!n) n = this.nomi[peer] = { nome: "", ruolo: ruolo || null, visto: 0 };
    if (nome && n.nome !== nome) { n.nome = nome; cambiato = true; }
    if (ruolo && n.ruolo !== ruolo) { n.ruolo = ruolo; cambiato = true; }
    n.visto = this.now();
    return nuovo ? "nuovo" : (cambiato ? "cambiato" : "");
  };
  Sessione.prototype.spettatori = function () {
    var out = [];
    for (var p in this.nomi) if (this.nomi[p].ruolo === "s") out.push({ peer: +p, nome: this.nomeDi(+p) });
    return out;
  };
  Sessione.prototype.chiScrive = function () {
    var out = [], t = this.now();
    for (var p in this.scrivono) if (this.scrivono[p] > t && +p !== this.peer) out.push(this.nomeDi(+p));
    return out;
  };

  /* --- dal relay ---------------------------------------------------------- */

  Sessione.prototype.ricevi = function (peer, body) {
    var m = unpack(body);
    if (!m) { this.illeggibili++; return null; }
    if (peer === this.peer) return null;          // un nostro pacchetto tornato indietro
    var t = this.now();
    if (m.tipo === "ciao") {
      if (!m.ciao) {
        var c = this.nomi[peer];
        if (c) {
          if (c.ruolo === "s") this.evento("spettvia", peer, c.nome);
          delete this.nomi[peer];
          this._avvisa();
        }
        return m;
      }
      var esito = this._notaNome(peer, m.nome, m.ruolo);
      if (esito === "nuovo") {
        if (m.ruolo === "s") this.evento("spett", peer, m.nome);
        // chi arriva ora non sa come ci chiamiamo: glielo si dice subito
        // (ma non a raffica, se arrivano in tanti insieme)
        if (t - this.ultimoCiaoRisposta >= CIAO_RISPOSTA_MS) { this.ultimoCiaoRisposta = t; this.ciao(); }
      }
      if (esito) { this._pubblica(false); this._avvisa(); }
      return m;
    }
    if (m.tipo === "scrive") {
      this._notaNome(peer, m.nome);
      this.scrivono[peer] = t + SCRIVE_DURA_MS;
      this._posta({ t: "scrive", peer: peer, nome: m.nome });
      this._avvisa();
      return m;
    }
    // un messaggio
    var tempi = (this.tempiPeer[peer] || []).filter(function (x) { return t - x < MSG_FINESTRA_MS; });
    if (tempi.length >= MSG_MAX) { this.tempiPeer[peer] = tempi; this.frenati++; return null; }
    if (this._notaNome(peer, m.nome)) this._pubblica(false);
    delete this.scrivono[peer];
    var v = { id: m.id, tipo: "msg", peer: peer, nome: m.nome || ("peer " + peer), testo: m.testo,
              ts: m.ts, arrivo: t, mio: false };
    if (m.pos) v.pos = m.pos;
    if (m.rispondeA) v.rispondeA = m.rispondeA;
    if (menziona(m.testo, this.nome, this.peer)) v.menzione = true;
    var e = this.store.aggiungi(v);
    if (e === "nuovo") {
      tempi.push(t); this.tempiPeer[peer] = tempi;
      this.ricevuti++;
      this._posta({ t: "voce", voce: v });
      if (this.onMessaggio) this.onMessaggio(v);
    }
    return m;
  };

  /* --- verso il relay ----------------------------------------------------- */

  Sessione.prototype._nuovoId = function () {
    return this.peer.toString(36) + "-" + this.now().toString(36) + "-" + Math.floor(this.rand() * 0xFFFFFF).toString(36);
  };

  /* Scrive un messaggio. extra: {rispondeA: voce|{id,nome,testo}, pos: true|{g,n,x,y}}.
   * Ritorna {ok:true, voce} oppure {ok:false, perche: "vuoto"|"troppi"|"scollegato"|"posizione", attesa}. */
  Sessione.prototype.scrivi = function (testo, extra) {
    extra = extra || {};
    testo = pulisci(testo || "", TESTO_MAX);
    var pos = extra.pos === true ? this.posMia() : (extra.pos || null);
    if (extra.pos && !pos) return { ok: false, perche: "posizione" };
    if (!testo && !pos) return { ok: false, perche: "vuoto" };
    var ris = extra.rispondeA ? { id: extra.rispondeA.id, nome: extra.rispondeA.nome || "", testo: extra.rispondeA.testo || "" } : null;

    if (!this.invia) {
      // scheda ospite: spedisce la portante, e la voce torna dal canale
      if (!this.canale || !this.portanteId) return { ok: false, perche: "scollegato" };
      this._posta({ t: "manda", a: this.portanteId, testo: testo, extra: { pos: pos, rispondeA: ris } });
      return { ok: true, voce: null };
    }

    var t = this.now();
    this.mieiTempi = this.mieiTempi.filter(function (x) { return t - x < MSG_FINESTRA_MS; });
    if (this.mieiTempi.length >= MSG_MAX) return { ok: false, perche: "troppi", attesa: MSG_FINESTRA_MS - (t - this.mieiTempi[0]) };
    var m = { id: this._nuovoId(), nome: this.nome, testo: testo, ts: t };
    if (pos) m.pos = pos;
    if (ris) m.rispondeA = ris;
    var corpo = pack(m);
    if (!corpo) return { ok: false, perche: "vuoto" };
    if (!this.invia(corpo)) { this.nonInviati++; return { ok: false, perche: "scollegato" }; }
    this.mieiTempi.push(t);
    this.inviati++;
    var n = normalizza(m);       // cio' che gli altri leggeranno, tagli compresi
    var v = { id: n.id, tipo: "msg", peer: this.peer, nome: this.nome || ("peer " + this.peer), testo: n.testo,
              ts: t, arrivo: t, mio: true };
    if (n.pos) v.pos = n.pos;
    if (n.rispondeA) v.rispondeA = n.rispondeA;
    this.store.aggiungi(v);
    this._posta({ t: "voce", voce: v });
    return { ok: true, voce: v };
  };

  /* «sta scrivendo...»: al massimo uno ogni 3 s, e solo se c'e' un collegamento. */
  Sessione.prototype.staScrivendo = function () {
    var t = this.now();
    if (!this.invia || t - this.ultimoScrive < SCRIVE_OGNI_MS) return false;
    this.ultimoScrive = t;
    var c = pack({ scrive: true, nome: this.nome });
    return !!(c && this.invia(c));
  };

  Sessione.prototype.ciao = function (via) {
    if (!this.invia) return false;
    var c = pack({ ciao: via ? 0 : 1, nome: this.nome, ruolo: this.ruolo });
    this.ultimoCiao = this.now();
    return !!(c && this.invia(c));
  };

  Sessione.prototype.setNome = function (nome) {
    nome = pulisci(nome || "", NOME_MAX);
    if (nome === this.nome) return;
    this.nome = nome;
    this.ciao();
    this._pubblica(false);
    this._avvisa();
  };

  /* Un evento di gioco nella stessa linea del tempo: non viaggia, lo genera
   * ogni scheda portante dagli eventi che il suo bridge conosce gia'. L'id e'
   * deterministico a finestre di 5 s: due schede dello stesso browser che
   * vedono lo stesso fatto producono la stessa voce, e il dedup le fonde. */
  Sessione.prototype.evento = function (genere, peer, nome, altro) {
    var t = this.now();
    var v = { id: "ev-" + genere + "-" + (peer || 0) + "-" + Math.floor(t / 5000), tipo: "ev", genere: genere,
              peer: peer || 0, nome: nome || "", ts: t, arrivo: t };
    if (altro) v.altro = altro;
    if (this.store.aggiungi(v) === "nuovo") this._posta({ t: "voce", voce: v });
    return v;
  };

  /* Una volta al secondo, dalla pagina: il «ciao» periodico, le scadenze. */
  Sessione.prototype.battito = function () {
    var t = this.now(), cambiato = false;
    if (this.invia && t - this.ultimoCiao >= CIAO_OGNI_MS) this.ciao();
    for (var p in this.nomi) {
      var n = this.nomi[p];
      if (n.ruolo === "s" && t - n.visto > PRESENZA_SCADE_MS) { delete this.nomi[p]; cambiato = true; }
    }
    for (var q in this.scrivono) if (this.scrivono[q] <= t) { delete this.scrivono[q]; cambiato = true; }
    if (this.invia) this._pubblica(false);
    if (cambiato) this._avvisa();
  };

  /* Un giocatore se n'e' andato (BYE dal relay): il nome non serve piu'. */
  Sessione.prototype.dimentica = function (peer) {
    delete this.scrivono[peer];
    if (this.nomi[peer] && this.nomi[peer].ruolo !== "s") { /* il nome resta: se torna lo si riconosce */ }
  };

  /* --- fra le schede ------------------------------------------------------ */

  Sessione.prototype._nomiPiatti = function () {
    var o = {};
    for (var p in this.nomi) o[p] = { nome: this.nomi[p].nome, ruolo: this.nomi[p].ruolo };
    return o;
  };

  Sessione.prototype._pubblica = function (conStoria) {
    if (!this.canale || !this.invia) return;
    var m = { t: "stato", tipo: this.tipo, peer: this.peer, nome: this.nome, ruolo: this.ruolo,
              nomi: this._nomiPiatti(), colori: this.colori, stanzaStato: this.statoStanza() };
    if (conStoria) m.voci = this.store.voci;
    this._posta(m);
  };

  /* La pagina ha (ri)aperto o perso il suo collegamento col relay. */
  Sessione.prototype.diventaPortante = function (invia) {
    this.invia = invia;
    this.portanteId = null; this.statoRemoto = null;
    this.ultimoCiao = 0;
    this._pubblica(true);
  };
  Sessione.prototype.diventaOspite = function () {
    if (this.invia) { this.ciao(true); this._posta({ t: "fine" }); }
    this.invia = null;
    this.chiedi();
  };
  Sessione.prototype.chiedi = function () { this._posta({ t: "chiedo" }); };

  Sessione.prototype.chiudi = function () {
    if (this.invia) { if (this.ruolo === "s") this.ciao(true); this._posta({ t: "fine" }); }
    if (this.canale) { try { this.canale.onmessage = null; if (this.canale.close) this.canale.close(); } catch (e) { /* niente */ } }
    this.canale = null; this.invia = null;
  };

  Sessione.prototype._dalCanale = function (m) {
    if (!m || typeof m !== "object" || m.da === this.id) return;
    var i, self = this;
    // «chiedo» SENZA stanza: la Mappa live, che non sa ancora quale stanza
    // guardare. Risponde ogni scheda portante, e la mappa sceglie.
    if (m.t === "chiedo") {
      if (this.invia && (m.stanza === undefined || m.stanza === null || m.stanza === this.stanza)) this._pubblica(true);
      return;
    }
    if (m.stanza !== this.stanza) return;
    if (m.t === "voce") {
      if (m.voce && this.store.aggiungi(m.voce) === "nuovo" && m.voce.tipo === "msg" && !m.voce.mio && !this.invia && this.onMessaggio) {
        this.onMessaggio(m.voce);
      }
      return;
    }
    if (m.t === "scrive") {
      if (!this.invia) { this.scrivono[m.peer] = this.now() + SCRIVE_DURA_MS; if (m.nome) this._notaNome(m.peer, m.nome); this._avvisa(); }
      return;
    }
    if (m.t === "manda") {
      if (this.invia && m.a === this.id) this.scrivi(m.testo, m.extra || {});
      return;
    }
    if (m.t === "fine") {
      if (m.da === this.portanteId) { this.portanteId = null; this.statoRemoto = null; if (this.onFine) this.onFine(); this._avvisa(); }
      return;
    }
    if (m.t === "stato") {
      if (Array.isArray(m.voci)) for (i = 0; i < m.voci.length; i++) this.store.aggiungi(m.voci[i]);
      // Fra due portanti (il pannello e una pagina della stanza aperte
      // insieme) si segue il pannello: e' lui che gioca.
      if (this.portanteId && this.portanteId !== m.da && this.statoRemoto &&
          this.statoRemoto.tipo === "pannello" && m.tipo !== "pannello" &&
          this.now() - this.portanteVisto < 4000) return;
      this.portanteId = m.da; this.portanteVisto = this.now(); this.statoRemoto = m;
      if (!this.invia) {
        // da ospiti, nomi e colori sono quelli della scheda che gioca
        this.nomi = {};
        Object.keys(m.nomi || {}).forEach(function (p) { self.nomi[p] = { nome: m.nomi[p].nome, ruolo: m.nomi[p].ruolo, visto: self.now() }; });
        if (m.peer !== this.peer) { this.peer = m.peer; }
        if (typeof m.nome === "string") this.nome = m.nome;
        this.colori = m.colori || {};
      }
      if (this.onStato) this.onStato(m);
      this._avvisa();
    }
  };

  /* Il canale fra le schede; null dove BroadcastChannel non c'e'. */
  function apriCanale() {
    try { return new BroadcastChannel(NOME_CANALE); } catch (e) { return null; }
  }

  root.OwlChat = {
    TESTO_MAX: TESTO_MAX, NOME_MAX: NOME_MAX, CITA_MAX: CITA_MAX, CORPO_MAX: CORPO_MAX,
    MSG_MAX: MSG_MAX, MSG_FINESTRA_MS: MSG_FINESTRA_MS, SCRIVE_OGNI_MS: SCRIVE_OGNI_MS,
    CIAO_OGNI_MS: CIAO_OGNI_MS, TENUTI: TENUTI, FRASI: FRASI, NOME_CANALE: NOME_CANALE,
    pulisci: pulisci, normalizza: normalizza, pack: pack, unpack: unpack,
    Store: Store, Sessione: Sessione, vista: vista, menziona: menziona, oraDi: oraDi,
    apriCanale: apriCanale
  };
})(typeof window !== "undefined" ? window : globalThis);
