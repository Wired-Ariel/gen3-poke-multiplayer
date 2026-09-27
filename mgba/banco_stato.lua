-- =============================================================================
-- banco_stato.lua - lo stato dell'amico che non viene piu' ribadito SCADE?
-- (2026-09-27)
-- =============================================================================
--
-- IL DIFETTO (dal campo, 27/09 sera). Dopo una lotta al Cable Club il GBA
-- fisico ha visto il fumetto "dialogo" sopra la testa dell'amico in mGBA per
-- 90 s, mentre l'amico camminava. Il suo "torno in overworld" era arrivato al
-- sito mentre il canale verso il GBA si stava riaprendo (frame trattenuti,
-- cioe' buttati), e il payload non ribadisce MAI l'overworld: solo gli stati
-- diversi hanno il battito (STATUS_HEARTBEAT, 2 s).
--
-- LA CURA (main.c, STATUS_STALE_FRAMES). Chi riceve fa scadere uno stato
-- diverso da overworld e da lotta che non arriva di nuovo da 420 frame.
--
-- COME LO PROVOCA. Nel giocatore 1, quando l'avatar dell'amico e' a schermo,
-- il banco scrive DIRETTAMENTE nella coda RX del payload (come fa lo script
-- con gli eventi veri) degli EVENT_STATUS per lo slot dell'amico:
--   A. un "dialogo" solo, poi silenzio: deve comparire l'icona, e dopo ~420
--      frame lo stato deve tornare overworld (statusExpired +1);
--   B. un "dialogo" ribadito ogni 120 frame per 900 frame (il battito vero):
--      NON deve scadere; poi silenzio: deve scadere;
--   C. una "lotta" sola, poi 900 frame di silenzio: NON deve scadere (un GBA
--      fisico in lotta tace per costruzione); poi un overworld per pulire.
--
-- USO: .\tools\prova-in-tre.ps1 -Rom <smeraldo-ita.gba> -Giocatori 2 -Syms it -Banco <...>\mgba\banco_stato.lua
-- Verdetto in build\prova-in-tre\banco_stato.txt, foto stato-*.png accanto.

local BASE = PAYLOAD_BASE or 0x0203CF80
local STAT = BASE + 0x10
local MBOX = BASE + (PAYLOAD_OFF_MAILBOX or 0x200)
local MAGIC_STATE = 0x53544154
local MAGIC_MBOX  = 0x584F424D

-- Offset di PayloadState (tabella S di inject_body.lua).
local PS_OBJECTID       = 0x18
local PS_STATUSRX       = 0x138
local PS_REMOTESTATUS   = 0x140
local PS_INDICATORSHOWN       = 0x144
local PS_STATUSEXPIRED  = 0x1AC

local ST_OVERWORLD, ST_BATTLE, ST_DIALOG = 0, 1, 2
local EVENT_STATUS = 5
local STALE = 420

local A = {}
do
    local f = io.open(AUTO_SYMS or "", "r")
    if f then
        for riga in f:lines() do
            local n, v = riga:match("#define%s+ADDR_([%w_]+)%s+%(?0[xX](%x+)")
            if n then A[n] = tonumber(v, 16) end
        end
        f:close()
    end
end

local DIR = AUTO_DIR or "."
local out = io.open(DIR .. "/banco_stato.txt", "w")
local function dire(s)
    console:log("[banco-stato] " .. s)
    if out then out:write(s .. "\n"); out:flush() end
end

if not (A.gObjectEvents and A.gMain) then
    dire("SIMBOLI MANCANTI: servono gObjectEvents e gMain")
    return
end

local function cont(off) return emu:read32(STAT + off) end
local function vblank() return emu:read32(A.gMain + 0x20) end

-- Lo slot dell'amico a schermo (0..2) e la sua mappa/posizione, o nil.
local function amico()
    if emu:read32(STAT) ~= MAGIC_STATE then return nil end
    local id = cont(PS_OBJECTID)
    if id >= 16 then return nil end
    local o = A.gObjectEvents + id * 0x24
    if (emu:read8(o) & 0x01) == 0 then return nil end
    local lid = emu:read8(o + 0x08)
    if lid < 0xE0 or lid > 0xE2 then return nil end
    return lid - 0xE0, emu:read8(o + 0x0A), emu:read8(o + 0x09),
        emu:read16(o + 0x10), emu:read16(o + 0x12)
end

-- Un EVENT_STATUS nella coda RX, come lo scrive lo script con gli eventi veri
-- (inject_body.lua, rxPush): 12 byte a rx[head], poi head avanza.
local seqFinto = 200
local function iniettaStato(slot, st, gruppo, numero, x, y)
    if emu:read32(MBOX) ~= MAGIC_MBOX then dire("mailbox non trovata"); return false end
    local txSlots = emu:read32(MBOX + 0x0C)
    local head    = emu:read32(MBOX + 0x10)
    local tail    = emu:read32(MBOX + 0x14)
    local slots   = emu:read32(MBOX + 0x18)
    local nuovo   = (head + 1) % slots
    if nuovo == tail then dire("coda RX piena"); return false end
    local a = MBOX + 0x20 + txSlots * 12 + head * 12
    seqFinto = (seqFinto + 1) % 256
    local b = { EVENT_STATUS + slot * 16, st, 0, seqFinto, gruppo, numero,
                x & 0xFF, (x >> 8) & 0xFF, y & 0xFF, (y >> 8) & 0xFF, 0, 0 }
    for i = 1, 12 do emu:write8(a + i - 1, b[i]) end
    emu:write32(MBOX + 0x10, nuovo)
    return true
end

local function foto(nome)
    local p = ("%s/stato-%s.png"):format(DIR, nome)
    local ok = pcall(function() emu:screenshot(p) end)
    dire(("foto %s: %s"):format(p, ok and "ok" or "FALLITA"))
end

-- fasi: ATTESA -> A_INIETTA -> A_ATTESA -> B_BATTITO -> B_SILENZIO
--       -> C_LOTTA -> FINE
local fase = "ATTESA"
local t0, ultimoBattito, scaduti0 = 0, 0, 0
local esiti = {}
local visto = nil
local finito = false

local function giudica(nome, ok, dettaglio)
    esiti[#esiti + 1] = ok
    dire(("%s: %s  (%s)"):format(nome, ok and "OK" or "NO", dettaglio))
end

local function tick()
    if finito then return end
    local slot, g, n, x, y = amico()
    local ora = vblank()
    if slot then visto = { slot, g, n, x, y } end

    if fase == "ATTESA" then
        if slot then
            dire(("amico a schermo: slot %d, mappa %d.%d (%d,%d)"):format(slot, g, n, x, y))
            fase, t0 = "A_INIETTA", ora + 60   -- un secondo per assestarsi
        end
        return
    end
    if not visto then return end
    local s, gg, nn, xx, yy = visto[1], visto[2], visto[3], visto[4], visto[5]

    if fase == "A_INIETTA" then
        if ora < t0 then return end
        scaduti0 = cont(PS_STATUSEXPIRED)
        dire(("A. un dialogo solo, poi silenzio (scaduti prima %d, icone %d)"):format(
            scaduti0, cont(PS_INDICATORSHOWN)))
        iniettaStato(s, ST_DIALOG, gg, nn, xx, yy)
        fase, t0 = "A_ATTESA", ora
        return
    end

    if fase == "A_ATTESA" then
        local dt = ora - t0
        if dt == 60 then foto("A-dialogo") end
        if dt == 60 then
            giudica("A1 lo stato arriva", cont(PS_REMOTESTATUS) == ST_DIALOG,
                "remoteStatus " .. cont(PS_REMOTESTATUS))
        end
        if cont(PS_STATUSEXPIRED) ~= scaduti0 then
            giudica("A2 il dialogo non ribadito scade", dt >= STALE - 5 and dt <= STALE + 120,
                ("dopo %d frame, remoteStatus %d, scaduti %d"):format(
                    dt, cont(PS_REMOTESTATUS), cont(PS_STATUSEXPIRED)))
            scaduti0 = cont(PS_STATUSEXPIRED)
            fase, t0 = "A_FOTO", ora   -- la foto 30 frame dopo: l'OAM si
                                       -- aggiorna al VBlank successivo
        elseif dt > STALE * 3 then
            giudica("A2 il dialogo non ribadito scade", false,
                ("dopo %d frame ancora remoteStatus %d"):format(dt, cont(PS_REMOTESTATUS)))
            fase = "FINE"
        end
        return
    end

    if fase == "A_FOTO" then
        if ora - t0 < 30 then return end
        foto("A-scaduto")
        giudica("A3 dopo la scadenza lo stato e' overworld (niente icona)",
            cont(PS_REMOTESTATUS) == ST_OVERWORLD,
            ("remoteStatus %d, icone mostrate finora %d"):format(
                cont(PS_REMOTESTATUS), cont(PS_INDICATORSHOWN)))
        dire("B. dialogo ribadito ogni 120 frame per 900 frame")
        iniettaStato(s, ST_DIALOG, gg, nn, xx, yy)
        fase, t0, ultimoBattito = "B_BATTITO", ora, ora
        return
    end

    if fase == "B_BATTITO" then
        if ora - ultimoBattito >= 120 then
            iniettaStato(s, ST_DIALOG, gg, nn, xx, yy)
            ultimoBattito = ora
        end
        if ora - t0 >= 900 then
            giudica("B1 col battito NON scade", cont(PS_STATUSEXPIRED) == scaduti0
                and cont(PS_REMOTESTATUS) == ST_DIALOG,
                ("900 frame, scaduti %d -> %d, remoteStatus %d"):format(
                    scaduti0, cont(PS_STATUSEXPIRED), cont(PS_REMOTESTATUS)))
            foto("B-battito")
            fase, t0 = "B_SILENZIO", ultimoBattito
        end
        return
    end

    if fase == "B_SILENZIO" then
        local dt = ora - t0
        if cont(PS_STATUSEXPIRED) ~= scaduti0 then
            giudica("B2 zitto il battito, scade", dt >= STALE - 5 and dt <= STALE + 120,
                ("dopo %d frame dall'ultimo battito"):format(dt))
            scaduti0 = cont(PS_STATUSEXPIRED)
            dire("C. una lotta sola, poi 900 frame di silenzio")
            iniettaStato(s, ST_BATTLE, gg, nn, xx, yy)
            fase, t0 = "C_LOTTA", ora
        elseif dt > STALE * 3 then
            giudica("B2 zitto il battito, scade", false, "mai scaduto")
            fase = "FINE"
        end
        return
    end

    if fase == "C_LOTTA" then
        if ora - t0 == 60 then foto("C-lotta") end
        if ora - t0 >= 900 then
            giudica("C la lotta NON scade", cont(PS_STATUSEXPIRED) == scaduti0
                and cont(PS_REMOTESTATUS) == ST_BATTLE,
                ("900 frame, scaduti %d -> %d, remoteStatus %d"):format(
                    scaduti0, cont(PS_STATUSEXPIRED), cont(PS_REMOTESTATUS)))
            iniettaStato(s, ST_OVERWORLD, gg, nn, xx, yy)
            fase = "FINE"
        end
        return
    end

    if fase == "FINE" then
        local tutti = #esiti > 0
        for _, e in ipairs(esiti) do tutti = tutti and e end
        dire(("VERDETTO %s (%d prove)"):format(tutti and "OK" or "NO", #esiti))
        finito = true
        if out then out:close(); out = nil end
    end
end

-- Si conta sul contatore VBlank del gioco, non sui callback di mGBA (che
-- scattano piu' volte per frame): tick() si chiama a ogni callback ma ogni
-- confronto e' su `ora`, quindi un frame visto due volte non cambia niente -
-- tranne i controlli su `dt == 60`, che vanno presi una volta sola.
local ultimoFrame = -1
callbacks:add("frame", function()
    local ora = vblank()
    if ora == ultimoFrame then return end
    ultimoFrame = ora
    local ok, err = pcall(tick)
    if not ok and not finito then dire("ERRORE nel banco: " .. tostring(err)); finito = true end
end)
dire("banco caricato")
