-- =============================================================================
-- banco_spawn.lua - l'amico CREATO a telecamera in movimento e' fuori posto?
-- (2026-09-28)
-- =============================================================================
--
-- DAL CAMPO (27/09): al Centro Pokemon, davanti al bancone del club, sul GBA
-- l'amico era disegnato qualche pixel di lato rispetto a mGBA. E' il punto in
-- cui il gioco vi rimette uscendo dalla saletta: il payload si risveglia e
-- CREA di nuovo l'avatar mentre il gioco vi fa fare il passo giu' dal bancone,
-- cioe' a telecamera in movimento.
--
-- IL SOSPETTO (decomp, event_object_movement.c): SpawnSpecialObjectEvent-
-- Parameterized corregge la posizione di UN TILE nel verso in cui la camera
-- si sta muovendo (GetObjectEventMovingCameraOffset), non dei pixel a meta'
-- scorrimento. Se lo spawn cade a meta' passo, lo sprite resta fuori griglia
-- e se lo porta dietro (poi si muove a passi di 16 px). Il banco del 28/08
-- (banco_subpixel) aveva provato solo il RIPOSIZIONAMENTO (Move...), che e'
-- giusto: la CREAZIONE non l'aveva mai misurata nessuno.
--
-- COME LO PROVOCA. Con l'amico a schermo e il giocatore locale che cammina
-- (l'autopilota), si manda al payload un VIA finto per lo slot dell'amico
-- (nella coda RX, come banco_stato.lua): il payload lo distrugge come si deve e
-- al SYNC successivo (entro ~1 s) lo ricrea. Si fotografa la camera nel frame
-- in cui `spawnAttempts` sale, poi - con l'amico FERMO - si misura il suo
-- sprite rispetto a un NPC fermo: due object event sulla griglia differiscono
-- di un multiplo di 16, a meno della "firma" di taglia misurata a riposo.
--
-- CRITERIO. Prima della cura: gli spawn a camera in movimento escono fuori
-- posto. Dopo la cura: tutti allineati, e la camera allo spawn sempre ferma.
--
-- USO: .\tools\prova-in-tre.ps1 -Rom <smeraldo-ita.gba> -Giocatori 2 -Syms it -Banco <...>\mgba\banco_spawn.lua
-- Verdetto in build\prova-in-tre\banco_spawn.txt.

local BASE = PAYLOAD_BASE or 0x0203CF80
local STAT = BASE + 0x10
local MBOX = BASE + (PAYLOAD_OFF_MAILBOX or 0x200)
local MAGIC_STATE, MAGIC_MBOX = 0x53544154, 0x584F424D

-- Offset di PayloadState (tabella S di inject_body.lua).
local PS_OBJECTID      = 0x18
local PS_SPAWNATTEMPTS = 0x1C
local PS_SPAWNREALIGNS = 0x1B0

local EVENT_LEAVE = 4
local PROVE = 5

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
local out = io.open(DIR .. "/banco_spawn.txt", "w")
local function dire(s)
    console:log("[banco-spawn] " .. s)
    if out then out:write(s .. "\n"); out:flush() end
end

if not (A.gObjectEvents and A.gSprites and A.gFieldCamera and A.gMain) then
    dire("SIMBOLI MANCANTI: servono gObjectEvents, gSprites, gFieldCamera, gMain")
    return
end

local function oe(i)     return A.gObjectEvents + i * 0x24 end
local function spr(i)    return A.gSprites + i * 0x44 end
local function s16(a)    local v = emu:read16(a); if v >= 0x8000 then v = v - 0x10000 end; return v end
local function s32(a)    local v = emu:read32(a); if v >= 0x80000000 then v = v - 0x100000000 end; return v end
local function camX()    return s32(A.gFieldCamera + 0x10) end
local function camY()    return s32(A.gFieldCamera + 0x14) end
local function cont(off) return emu:read32(STAT + off) end
local function vblank()  return emu:read32(A.gMain + 0x20) end

local function remoto()
    if emu:read32(STAT) ~= MAGIC_STATE then return nil end
    local id = cont(PS_OBJECTID)
    if id >= 16 then return nil end
    local o = oe(id)
    if (emu:read8(o) & 0x01) == 0 then return nil end
    local lid = emu:read8(o + 0x08)
    if lid < 0xE0 or lid > 0xE2 then return nil end
    return id, lid - 0xE0
end

-- il VIA finto nella coda RX (stesso impacchettamento di banco_stato.lua)
local function iniettaVia(slot)
    if emu:read32(MBOX) ~= MAGIC_MBOX then return false end
    local txSlots = emu:read32(MBOX + 0x0C)
    local head, tail, slots = emu:read32(MBOX + 0x10), emu:read32(MBOX + 0x14), emu:read32(MBOX + 0x18)
    local nuovo = (head + 1) % slots
    if nuovo == tail then return false end
    local a = MBOX + 0x20 + txSlots * 12 + head * 12
    local b = { EVENT_LEAVE + slot * 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }
    for i = 1, 12 do emu:write8(a + i - 1, b[i]) end
    emu:write32(MBOX + 0x10, nuovo)
    return true
end

-- Un NPC FERMO come riferimento (come banco_subpixel.lua)
local rif = { id = nil, x = nil, y = nil, fermo = 0 }
local function riferimento(escludi)
    if rif.id then
        local s = spr(emu:read8(oe(rif.id) + 0x04))
        local x, y = s16(s + 0x20), s16(s + 0x22)
        if (emu:read8(oe(rif.id)) & 1) == 0 or x ~= rif.x or y ~= rif.y then
            rif.id, rif.fermo = nil, 0
            return nil
        end
        rif.fermo = rif.fermo + 1
        return rif.fermo >= 8 and s or nil
    end
    local pl = emu:read8((A.gPlayerAvatar or 0) + 0x05)
    for i = 0, 15 do
        if i ~= escludi and i ~= pl and (emu:read8(oe(i)) & 1) ~= 0 then
            local lid = emu:read8(oe(i) + 0x08)
            if lid < 0xE0 or lid > 0xE2 then
                local s = spr(emu:read8(oe(i) + 0x04))
                rif.id, rif.x, rif.y, rif.fermo = i, s16(s + 0x20), s16(s + 0x22), 0
                return nil
            end
        end
    end
    return nil
end

-- l'amico fermo da 8 controlli: posizione sprite, o nil
local rem = { x = nil, y = nil, fermo = 0 }
local function remotoFermo(id)
    local s = spr(emu:read8(oe(id) + 0x04))
    local x, y = s16(s + 0x20), s16(s + 0x22)
    if x ~= rem.x or y ~= rem.y then rem.x, rem.y, rem.fermo = x, y, 0; return nil end
    rem.fermo = rem.fermo + 1
    if rem.fermo < 8 then return nil end
    return x, y
end

local fase, t0 = "FIRMA", 0
local firmaX, firmaY
local spawnPrima, camAllo = 0, nil
-- Lo spawn avviene in payload_cb1, all'INIZIO del frame, prima che il gioco
-- muova la camera: la camera che vede e' quella di fine frame precedente.
local camPrec = { 0, 0 }
local esiti = {}
local ultimo = -1
local finito = false

local function tick()
    if finito then return end
    local ora = vblank()
    local id, slot = remoto()

    -- la camera nel frame esatto in cui il payload ricrea l'amico
    if fase == "ASPETTA_SPAWN" and cont(PS_SPAWNATTEMPTS) ~= spawnPrima and not camAllo then
        camAllo = { camPrec[1], camPrec[2] }
    end
    camPrec = { camX(), camY() }
    if ora % 2 ~= 0 then return end

    if fase == "FIRMA" then
        if not id then return end
        local r = riferimento(id)
        if not r then return end
        local x, y = remotoFermo(id)
        if not x then return end
        firmaX = (x - s16(r + 0x20)) % 16
        firmaY = (y - s16(r + 0x22)) % 16
        dire(("firma a riposo: (%d,%d) px (taglia degli sprite, non un difetto); riferimento oe %d")
             :format(firmaX, firmaY, rif.id))
        rem.x, fase = nil, "PROVOCA"
        return
    end

    if fase == "PROVOCA" then
        if not id then return end
        -- si provoca solo a camera in movimento: e' la condizione sospetta
        if camX() == 0 and camY() == 0 then return end
        spawnPrima = cont(PS_SPAWNATTEMPTS)
        camAllo = nil
        if iniettaVia(slot) then
            dire(("prova %d: VIA iniettato a camera (%d,%d)"):format(#esiti + 1, camX(), camY()))
            fase, t0 = "ASPETTA_SPAWN", ora
        end
        return
    end

    if fase == "ASPETTA_SPAWN" then
        if camAllo and id then
            rem.x, fase, t0 = nil, "MISURA", ora
        elseif ora - t0 > 900 then
            dire("  nessuno spawn entro 15 s: prova saltata")
            fase = "PROVOCA"
        end
        return
    end

    if fase == "MISURA" then
        if not id then return end
        local r = riferimento(id)
        local x, y = remotoFermo(id)
        if not (r and x) then
            if ora - t0 > 1200 then
                dire("  l'amico o il riferimento non stanno mai fermi: prova saltata")
                fase = "PROVOCA"
            end
            return
        end
        local dx = (x - s16(r + 0x20)) % 16
        local dy = (y - s16(r + 0x22)) % 16
        local ok = (dx == firmaX and dy == firmaY)
        local mossa = camAllo[1] ~= 0 or camAllo[2] ~= 0
        esiti[#esiti + 1] = { ok = ok, mossa = mossa }
        dire(("  esito %d: scarto dalla griglia (%d,%d) px -> %s | camera allo spawn (%d,%d) | ripiazzati dal payload finora %d")
             :format(#esiti, dx, dy, ok and "ALLINEATO" or "FUORI POSTO", camAllo[1], camAllo[2], cont(PS_SPAWNREALIGNS)))
        if #esiti == 1 or not ok then
            pcall(function() emu:screenshot(("%s/spawn-%d.png"):format(DIR, #esiti)) end)
        end
        rem.x, fase = nil, "PROVOCA"
        if #esiti >= PROVE then
            local buoni, mosse, mosseFuori = 0, 0, 0
            for _, e in ipairs(esiti) do
                if e.ok then buoni = buoni + 1 end
                if e.mossa then mosse = mosse + 1; if not e.ok then mosseFuori = mosseFuori + 1 end end
            end
            dire(("RISULTATO: %d/%d spawn allineati | spawn a camera in movimento %d, di cui fuori posto %d | ripiazzati dal payload %d")
                 :format(buoni, #esiti, mosse, mosseFuori, cont(PS_SPAWNREALIGNS)))
            dire(buoni == #esiti and "VERDETTO: ALLINEATI" or "VERDETTO: FUORI POSTO")
            finito = true
        end
    end
end

callbacks:add("frame", function()
    local ora = vblank()
    if ora == ultimo then return end
    ultimo = ora
    local ok, err = pcall(tick)
    if not ok and not finito then dire("ERRORE nel banco: " .. tostring(err)); finito = true end
end)
dire("banco avviato: aspetto l'amico a schermo e un NPC fermo")
