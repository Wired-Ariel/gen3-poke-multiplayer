# =============================================================================
# prepara-sito-web.ps1 - assembla in build\sito-web\ la pagina da PUBBLICARE
# =============================================================================
#
# NOTA: file da tenere in ASCII puro (PowerShell 5.1 legge gli .ps1 come ANSI).
#
# Il sito e' statico: le pagine di web\ (ingresso, pannello, stanze, stanza,
# come funziona - ognuna in italiano e in inglese) + js + css + fonts + img +
# mbstub.gba (il programma che il browser carica nel GBA via multiboot) +
# config.js con il relay e la stanza di default. Si pubblica su qualunque hosting https (Cloudflare Pages, GitHub
# Pages, Netlify, un VPS con Caddy): WebUSB pretende https, oppure localhost.
#
# Uso:
#   .\tools\prepara-sito-web.ps1 -Relay wss://relay.esempio.it/ws -Stanza 4242
#   .\tools\prepara-sito-web.ps1                 # senza default: l'utente li scrive
#
# LA GUARDIA ANTI-VERSIONE-VECCHIA, come per il pacchetto dell'amico: lo stub
# dentro al sito deve essere quello costruito sull'ULTIMO payload -WithSio.
# Un sito con dentro un mbstub vecchio (o, peggio, con la build da emulatore,
# muta sul cavo: e' successo il 2026-08-22) sembrerebbe un guasto hardware a
# chiunque lo provi.

param(
    [string]$Relay = "",
    [int]$Stanza = 0,
    [string]$Out = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$web  = Join-Path $root "web"
if (-not $Out) { $Out = Join-Path $root "build\sito-web" }

# --- lo stub: c'e', e' fresco, e ingloba il payload da hardware ---------------
$mbstub   = Join-Path $root "hw\mbstub\build\mbstub.gba"
$payload  = Join-Path $root "build\payload.bin"
$pmap     = Join-Path $root "build\payload.map"
if (-not (Test-Path $mbstub))  { throw "manca $mbstub : costruiscilo con .\build.ps1 -Syms it -WithSio e poi .\hw\mbstub\build.ps1" }
if (-not (Test-Path $payload)) { throw "manca $payload : .\build.ps1 -Syms it -WithSio" }
if (-not (Test-Path $pmap))    { throw "manca $pmap" }

$pb = [System.IO.File]::ReadAllBytes($payload)
$mb = [System.IO.File]::ReadAllBytes($mbstub)
# ingloba? (ricerca del blob, come la verifica byte per byte del 2026-08-22)
$hay = [System.Text.Encoding]::GetEncoding(28591).GetString($mb)
$needle = [System.Text.Encoding]::GetEncoding(28591).GetString($pb)
if ($hay.IndexOf($needle, [System.StringComparison]::Ordinal) -lt 0) {
    throw "mbstub.gba NON ingloba l'ultimo build\payload.bin: rifai .\hw\mbstub\build.ps1 (dopo .\build.ps1 -Syms it -WithSio)"
}
if ((Get-Content $pmap -Raw) -notmatch "sio\.o") {
    throw "build\payload.map non contiene sio.o: l'ultimo payload e' la build da EMULATORE (muta sul cavo). Rifai .\build.ps1 -Syms it -WithSio e poi lo stub."
}
$sorgenti = @("payload\main.c", "payload\sio.c", "payload\hook.S", "payload\payload.ld", "build.ps1", "hw\mbstub\main.c", "hw\mbstub\build.ps1")
$tStub = (Get-Item $mbstub).LastWriteTimeUtc
foreach ($s in $sorgenti) {
    $p = Join-Path $root $s
    if ((Test-Path $p) -and ((Get-Item $p).LastWriteTimeUtc -gt $tStub)) {
        throw "$s e' piu' recente di mbstub.gba: ricompila (build.ps1 -Syms it -WithSio, poi hw\mbstub\build.ps1) prima di preparare il sito"
    }
}

# --- le pagine inglesi sono GENERATE: devono essere quelle di adesso -----------
#
# Dal 2026-10-11 gioca, stanze, stanza e progetto tengono le due lingue nello
# stesso file, e la gemella -en.html la scrive tools\gen_en.py. Pubblicare una
# -en rimasta indietro vorrebbe dire dare a chi legge in inglese il sito di
# ieri (bottoni che il JavaScript nuovo non trova piu'): si controlla qui, e
# se non combacia ci si ferma.
$python = if (Test-Path 'D:\Progettini\Python313\python.exe') {
    'D:\Progettini\Python313\python.exe'
} else {
    (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $python) { throw "non trovo Python: serve per controllare le pagine inglesi (tools\gen_en.py --check)" }
& $python (Join-Path $root "tools\gen_en.py") --check
if ($LASTEXITCODE -ne 0) { throw "le pagine -en.html non sono aggiornate: lancia  python tools\gen_en.py  e riprova" }

# --- copia -------------------------------------------------------------------
if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Path $Out | Out-Null
foreach ($d in @("js", "img", "css", "fonts")) { New-Item -ItemType Directory -Path (Join-Path $Out $d) | Out-Null }
$pagine = @("index.html", "index-en.html", "gioca.html", "gioca-en.html", "stanze.html", "stanze-en.html",
            "stanza.html", "stanza-en.html", "progetto.html", "progetto-en.html",
            "test.html", "mb_test.html", "bridge_test.html")
foreach ($f in $pagine) {
    $sorgente = Join-Path $web $f
    if (-not (Test-Path $sorgente)) { throw "manca web\$f" }
    Copy-Item $sorgente (Join-Path $Out $f)
}
Copy-Item (Join-Path $web "js\*.js") (Join-Path $Out "js\")
Copy-Item (Join-Path $web "css\*.css") (Join-Path $Out "css\")
# I FONT LOCALI (2026-10-11): niente risorse esterne, quindi stanno nel sito.
# Senza, le pagine ricadono sui font di sistema: funzionano, ma non sono
# quelle disegnate - e nessuno se ne accorgerebbe guardando il log.
$font = @(Get-ChildItem (Join-Path $web "fonts\*.woff2") -ErrorAction SilentlyContinue)
if ($font.Count -lt 4) { throw "in web\fonts mancano i font (.woff2): ne trovo $($font.Count), ne servono 4 (vedi web\fonts\LICENZA.txt)" }
Copy-Item (Join-Path $web "fonts\*") (Join-Path $Out "fonts\")
Copy-Item (Join-Path $web "img\*.png") (Join-Path $Out "img\")
New-Item -ItemType Directory -Force -Path (Join-Path $Out "img\prove") | Out-Null
Copy-Item (Join-Path $web "img\prove\*.png") (Join-Path $Out "img\prove\")
# Ogni file che una pagina chiede deve esserci: un link a un .js o a un .css
# dimenticato qui sopra sarebbe una pagina rotta solo in produzione.
foreach ($f in $pagine) {
    $testo = Get-Content -Raw -Encoding UTF8 (Join-Path $Out $f)
    foreach ($m in [regex]::Matches($testo, '(?:src|href)="((?:js|css|img|fonts)/[^"?#]+)')) {
        $rel = $m.Groups[1].Value -replace '/', '\'
        if (-not (Test-Path (Join-Path $Out $rel))) { throw "$f chiede $($m.Groups[1].Value), che nel sito assemblato non c'e'" }
    }
}
Copy-Item $mbstub (Join-Path $Out "mbstub.gba")

# --- lo script per chi gioca in emulatore (2026-08-26) -----------------------
#
# Il sito lo serve come TEMPLATE e il JavaScript ci riscrive le tre righe della
# configurazione prima di darlo all'utente ("Scarica lo script per
# l'emulatore"): cosi' chi gioca in mGBA sceglie la stanza QUI, e non deve
# modificare un file Lua a mano ogni volta.
#
# Si RIGENERA sempre, invece di copiare quello che c'e': un template col
# payload di ieri e' esattamente il difetto che le guardie di questo progetto
# esistono per fermare, e nessuno se ne accorgerebbe (lo script si carica, il
# gioco parte, e i due giocatori hanno payload diversi).
#
# Il relay ci va IN CHIARO (ws://): il Lua di mGBA non ha TLS. Il valore qui e'
# solo il default del template - il sito lo riscrive con quello scelto
# dall'utente, convertendo wss:// in ws://.
$relayLua = $Relay -replace '^wss://', 'ws://'
if ($relayLua -notmatch '^ws://') { $relayLua = "ws://" + ($relayLua -replace '^https?://', '') }
$luaOut = Join-Path $Out "gen3-poke-multiplayer-emulatore.lua"
& (Join-Path $root "build.ps1") -LinkRole relay -RelayUrl $relayLua -RelayRoom $Stanza `
    -RelayPeer 0 -Syms it -OutName emulatore | Out-Null
if ($LASTEXITCODE -ne 0) { throw "build del template per l'emulatore fallita" }
$luaSorgente = Join-Path $root "mgba\inject.emulatore.lua"
if (-not (Test-Path $luaSorgente)) { throw "manca $luaSorgente dopo la build" }
Copy-Item $luaSorgente $luaOut
# Lo stesso modello per la ROM INGLESE (USA/Europa, BPEE), 2026-09-24: il sito fa
# scegliere la ROM accanto a "Scarica lo script" e prende questo file per "usa".
& (Join-Path $root "build.ps1") -LinkRole relay -RelayUrl $relayLua -RelayRoom $Stanza `
    -RelayPeer 0 -Syms usa -OutName emulatore-usa | Out-Null
if ($LASTEXITCODE -ne 0) { throw "build del template per la ROM inglese fallita" }
Copy-Item (Join-Path $root "mgba\inject.emulatore-usa.lua") (Join-Path $Out "gen3-poke-multiplayer-emulatore-usa.lua")
# La guardia che conta: le tre righe che il sito riscrivera' devono esserci.
# Se build.ps1 cambiasse formato, meglio fermarsi qui che pubblicare un sito
# il cui bottone fallisce in faccia all'utente.
$luaTesto = Get-Content -Raw $luaOut
foreach ($riga in @("RELAY_URL", "RELAY_ROOM", "RELAY_PEER")) {
    if ($luaTesto -notmatch "(?m)^$riga\s*=") {
        throw "il template per l'emulatore non ha la riga ${riga}: il generatore del sito non potrebbe configurarlo"
    }
}
Write-Output ("script emu: {0:N0} byte (stanza {1}, relay {2}, peer sorteggiato)" -f `
    (Get-Item $luaOut).Length, $Stanza, $relayLua)

# SI RIMETTE A POSTO build\payload.bin, e non e' pignoleria.
#
# La build qui sopra e' quella per l'EMULATORE (-LinkRole relay, niente
# -WithSio), e sovrascrive build\payload.bin e build\payload.map. Chi poi
# rifacesse lo stub - cioe' l'ordine naturale delle cose - vi inglobava una
# build MUTA sul cavo. Dal 2026-08-28 hw\mbstub\build.ps1 ha la sua guardia e
# si ferma, ma lasciare dietro uno stato che fa fallire il comando successivo
# resta un difetto di questo script, non del prossimo. Quindi si ricompila la
# build da hardware e si torna allo stato giusto.
& (Join-Path $root "build.ps1") -Syms it -WithSio | Out-Null
if ($LASTEXITCODE -ne 0) { throw "ricostruzione della build -WithSio fallita dopo il template per l'emulatore" }
if ((Get-Content (Join-Path $root "build\payload.map") -Raw) -notmatch "sio\.o") {
    throw "dopo il ripristino build\payload.map non contiene sio.o: build\ e' rimasta nello stato da emulatore"
}
Write-Output "build     : build\payload.bin rimessa alla versione da hardware (-WithSio)"

# --- la mappa live -----------------------------------------------------------
# mappa.html e' LO STESSO file del pannello Python: prende le posizioni da
# `api/posizioni` quando c'e' un server dietro, e via BroadcastChannel quando
# la apre il pannello web. Un file solo, due sorgenti - se si duplicasse, le
# due copie divergerebbero alla prima correzione.
# I dati (net\mappa\) sono ~15 MB generati da tools\gen_mappa.py: se mancano,
# la mappa si aprirebbe VUOTA senza dire perche', quindi qui si grida.
$mappaHtml = Join-Path $root "net\mappa.html"
$mappaDati = Join-Path $root "net\mappa"
if (-not (Test-Path $mappaHtml)) { throw "manca net\mappa.html" }
if (-not (Test-Path (Join-Path $mappaDati "dati.json"))) {
    throw "manca net\mappa\dati.json: genera i dati della mappa con  D:\Progettini\Python313\python.exe tools\gen_mappa.py"
}
# nomi.json (2026-10-11): i soli nomi delle mappe, per la chat ("posizione:
# Ciclamipoli"). Lo scrive gen_mappa.py insieme a dati.json; se i dati sono di
# prima, lo si ricava qui da dati.json senza rigenerare tutto.
if (-not (Test-Path (Join-Path $mappaDati "nomi.json"))) {
    & $python (Join-Path $root "tools\gen_mappa.py") --solo-nomi $mappaDati
    if ($LASTEXITCODE -ne 0) { throw "non riesco a scrivere net\mappa\nomi.json (tools\gen_mappa.py --solo-nomi)" }
}
# LE SQUADRE (2026-10-16, secondo giro): specie.json con tipi, frontale e numero
# del Pokedex, squadra.json col tipo delle mosse e l'icona degli strumenti, e
# le due cartelle di immagini frontali\ (64x64, normale e -shiny) e strumenti\.
# Le scrive  tools\gen_mappa.py --solo-specie  dalla decomp. Dati di prima
# (voci da 2 campi) = la scheda della squadra senza sprite ne' tipi: si grida.
$specieJson = Join-Path $mappaDati "specie.json"
$squadraJson = Join-Path $mappaDati "squadra.json"
$cmdSpecie = "D:\Progettini\Python313\python.exe tools\gen_mappa.py --solo-specie net\mappa --decomp <pokeemerald>"
if (-not (Test-Path $specieJson) -or -not (Test-Path $squadraJson)) {
    throw "mancano net\mappa\specie.json o squadra.json: generali con  $cmdSpecie"
}
$primaSpecie = (Get-Content $specieJson -Raw -Encoding UTF8 | ConvertFrom-Json) | Where-Object { $_ } | Select-Object -First 1
$primaMossa = (Get-Content $squadraJson -Raw -Encoding UTF8 | ConvertFrom-Json).mosse | Where-Object { $_ } | Select-Object -First 1
if ($primaSpecie.Count -lt 5 -or $primaMossa.Count -lt 3 -or
    -not (Test-Path (Join-Path $mappaDati "frontali")) -or -not (Test-Path (Join-Path $mappaDati "strumenti"))) {
    throw "net\mappa\specie.json / squadra.json sono di prima delle squadre (niente tipi, frontali, icone degli strumenti): rigenerali con  $cmdSpecie"
}
$nFront = (Get-ChildItem -File (Join-Path $mappaDati "frontali")).Count
$nStru = (Get-ChildItem -File (Join-Path $mappaDati "strumenti")).Count
Write-Output ("squadre   : {0} frontali, {1} icone di strumenti" -f $nFront, $nStru)
Copy-Item $mappaHtml (Join-Path $Out "mappa.html")
Copy-Item $mappaDati (Join-Path $Out "mappa") -Recurse
$nMappa = (Get-ChildItem -Recurse -File (Join-Path $Out "mappa") | Measure-Object -Property Length -Sum)
Write-Output ("mappa     : {0} file, {1:N1} MB" -f $nMappa.Count, ($nMappa.Sum / 1MB))

# --- config.js: i default che la pagina propone ------------------------------
$cfg = "// generato da tools\prepara-sito-web.ps1 - non modificare a mano`n" +
       "window.GEN3PM_DEFAULTS = { relay: " + (ConvertTo-Json $Relay) + ", stanza: " + $Stanza + ", mbstub: `"mbstub.gba`" };`n"
[System.IO.File]::WriteAllText((Join-Path $Out "config.js"), $cfg, (New-Object System.Text.UTF8Encoding($false)))

$n = (Get-ChildItem -Recurse -File $Out | Measure-Object -Property Length -Sum)
Write-Output ("sito      : {0} ({1} file, {2} byte)" -f $Out, $n.Count, $n.Sum)
Write-Output ("stub      : mbstub.gba {0} byte, ingloba payload.bin {1} byte (build -WithSio)" -f $mb.Length, $pb.Length)
Write-Output ("default   : relay '{0}', stanza {1}" -f $Relay, $Stanza)
Write-Output ""
Write-Output "Pubblicazione (vedi web\README.md): carica il contenuto della cartella su un hosting https."
Write-Output "Prova locale: cd build\sito-web ; D:\Progettini\Python313\python.exe -m http.server 7413 --bind 127.0.0.1"
Write-Output "              poi http://127.0.0.1:7413/ in Chrome/Edge (localhost vale come https per WebUSB)."
