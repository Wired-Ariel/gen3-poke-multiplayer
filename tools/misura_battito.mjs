// misura_battito.mjs - quanto rallentano i timer a scheda NASCOSTA, in un
// Chromium vero (2026-09-27).
//
// Il browser integrato dell'app non rallenta le schede nascoste (misurato:
// 300 tick su 300 in 30 s), quindi il difetto «il gioco crasha col browser in
// background» li' non si vede. Qui si apre Edge con un profilo usa-e-getta e
// la porta DevTools, si carica web/misura_battito.html, la si nasconde
// portando davanti un'altra scheda, e minuto per minuto si contano i tick di
// tre timer da 100 ms: quello della pagina, un Worker nudo e Battito.
//
// Uso (con `web-test` avviato sulla 7822):
//   node tools\misura_battito.mjs [minuti=7]
// Il throttling intensivo di Chromium parte dopo 5 minuti di scheda nascosta:
// per vederlo servono piu' di 5 minuti.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORTA = 9333;
const URL_PAGINA = "http://127.0.0.1:7822/misura_battito.html";
const MINUTI = Number(process.argv[2] || 7);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profilo = mkdtempSync(join(tmpdir(), "edge-battito-"));
const edge = spawn(EDGE, [
  `--remote-debugging-port=${PORTA}`, `--user-data-dir=${profilo}`,
  "--no-first-run", "--no-default-browser-check", "--new-window", URL_PAGINA,
], { stdio: "ignore" });

async function json(path, method = "GET") {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORTA}${path}`, { method }); return await r.json(); }
    catch { await sleep(250); }
  }
  throw new Error("DevTools non risponde");
}

function collega(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0; const attese = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && attese.has(m.id)) { attese.get(m.id)(m); attese.delete(m.id); } };
  const aperto = new Promise((r) => { ws.onopen = r; });
  return {
    aperto,
    cmd(method, params = {}) { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((r) => attese.set(id, r)); },
    async eval(expr) {
      const m = await this.cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      return m.result?.result?.value;
    },
    chiudi() { ws.close(); },
  };
}

try {
  await sleep(1500);
  let bersaglio = null;
  for (let i = 0; i < 40 && !bersaglio; i++) {
    const lista = await json("/json/list");
    bersaglio = lista.find((t) => t.type === "page" && t.url.startsWith(URL_PAGINA));
    if (!bersaglio) await sleep(250);
  }
  if (!bersaglio) throw new Error("la pagina di misura non si e' aperta");
  const A = collega(bersaglio.webSocketDebuggerUrl); await A.aperto;
  for (let i = 0; i < 40; i++) { if (await A.eval("typeof __riassunto === 'function'")) break; await sleep(250); }
  const info = await A.eval("({ ua: navigator.userAgent, battitoNelWorker: __m.batAttivo, vis: document.visibilityState })");
  console.log("pagina pronta:", JSON.stringify(info));

  // L'altra scheda davanti: la nostra diventa "hidden".
  const nuova = await json("/json/new?about:blank", "PUT");
  const B = collega(nuova.webSocketDebuggerUrl); await B.aperto;
  await B.cmd("Page.bringToFront");
  await sleep(1000);
  console.log("visibilita' dopo il cambio scheda:", await A.eval("document.visibilityState"));

  const t0 = await A.eval("performance.now()");
  for (let m = 1; m <= MINUTI; m++) {
    await sleep(60000);
    const t = await A.eval("performance.now()");
    const r = await A.eval(`__riassunto(${t - 60000}, ${t})`);
    console.log(`minuto ${m} nascosta (${await A.eval("document.visibilityState")}): ` +
      Object.entries(r).map(([k, v]) => `${k} ${v.tick}/${v.attesi} (buco max ${v.buco_max_ms} ms)`).join(" | "));
  }
  const tot = await A.eval(`__riassunto(${t0}, performance.now())`);
  console.log("TOTALE:", JSON.stringify(tot));
  A.chiudi(); B.chiudi();
} catch (e) {
  console.error("ERRORE:", e.message);
  process.exitCode = 1;
} finally {
  edge.kill();
}
