-- =============================================================================
-- banco_surf.lua - il Surf VERO, con l'amico accanto (2026-09-27)
-- =============================================================================
--
-- PERCHE' ESISTE. Il 26/09 banco_mn.lua ha misurato la casella
-- gFieldEffectArguments e ha dato OK, ma il 27/09 Lain, sul fisico, ha rifatto
-- Surf con l'amico nell'erba e il Pokemon usciva ancora sbagliato. Il banco
-- misurava una causa possibile, non il sintomo. Questo banco guarda il
-- SINTOMO: fa partire un Surf vero e fotografa il Pokemon che esce, e accanto
-- a ogni foto scrive le 16 palette degli sprite (sSpritePaletteTags,
-- 0x03000CF0: .bss di sprite.o nel .map, uguale nella ROM italiana - trovato
-- nel literal pool di IndexOfSpritePaletteTag).
--
-- L'IPOTESI DA MISURARE. In overworld il gioco riserva le palette 0-11 agli
-- NPC (gReservedSpritePaletteCount = 12, event_object_movement.c:2011) e ne
-- restano 4 per effetti di campo, interfaccia e per il Pokemon della MN
-- (CreatePicSprite -> LoadCompressedSpritePalette). Se sono piene, il Pokemon
-- non ha palette e finisce sulla 15: colori sbagliati, il «negativo».
--
-- SCENA: salvataggio sul Percorso 110 (0.25) in (26,68), acqua a nord, erba
-- alta a sud; Lombre ha Surf. Il giocatore 1 (questo) resta fermo, si gira a
-- nord e preme A a impulsi; al giocatore 2 si inietta lo stato LOTTA (tipo 5,
-- dir 1), come quando l'amico e' in una lotta nell'erba, cosi' sopra di lui
-- compare l'icona. BANCO_SENZA_ICONA = true fa la stessa scena senza stato.
--
-- USO: .\tools\prova-in-tre.ps1 -Rom <copia con il .sav del Percorso 110> -Giocatori 2 -Syms it -Banco <...>\mgba\banco_surf.lua
-- Uscita: build\prova-in-tre\banco_surf.txt + surf-NN.png

local BASE = PAYLOAD_BASE or 0x0203CF80
local STAT = BASE + 0x10
local MBOX = BASE + (PAYLOAD_OFF_MAILBOX or 0x200)
local MAGIC_STATE = 0x53544154
local MAGIC_MBOX  = 0x584F424D
local PS_OBJECTID = 0x18

local MB_TXSLOTS = 0x0C
local MB_RXHEAD  = 0x10
local MB_RXTAIL  = 0x14
local MB_RXSLOTS = 0x18
local MB_TX      = 0x20
local EVENT_SIZE = 12

local PAL_TAGS = 0x03000CF0          -- sSpritePaletteTags[16]
local RESERVED = 0x0300301C          -- gReservedSpritePaletteCount
local SENZA_ICONA = rawget(_G, "BANCO_SENZA_ICONA") == true

local A = {}
do
    local f = io.open(AUTO_SYMS or "", "r")
    if f then
        for riga in f:lines() do
            local n, v = riga:match("#define%s+ADDR_(%w+)%s+%(?0[xX](%x+)")
            if n then A[n] = tonumber(v, 16) end
        end
        f:close()
    end
end

local DIR = AUTO_DIR or "."
local out = io.open(DIR .. "/banco_surf.txt", "w")
local function dire(s)
    console:log("[surf] " .. s)
    if out then out:write(s .. "\n"); out:flush() end
end

local function oe(i) return A.gObjectEvents + i * 0x24 end

local function remotoASchermo()
    if emu:read32(STAT) ~= MAGIC_STATE then return false end
    local id = emu:read32(STAT + PS_OBJECTID)
    if id >= 16 then return false end
    local o = oe(id)
    if (emu:read8(o) & 1) == 0 then return false end
    local lid = emu:read8(o + 0x08)
    return lid >= 0xE0 and lid <= 0xE2
end

local function ultimoRx()
    if emu:read32(MBOX) ~= MAGIC_MBOX then return nil end
    local head  = emu:read32(MBOX + MB_RXHEAD)
    local slots = emu:read32(MBOX + MB_RXSLOTS)
    if slots == 0 then return nil end
    local rxBase = MB_TX + emu:read32(MBOX + MB_TXSLOTS) * EVENT_SIZE
    local a = MBOX + rxBase + ((head - 1) % slots) * EVENT_SIZE
    local b = {}
    for i = 0, EVENT_SIZE - 1 do b[i + 1] = emu:read8(a + i) end
    return b
end

local function deliverRx(b)
    local head  = emu:read32(MBOX + MB_RXHEAD)
    local tail  = emu:read32(MBOX + MB_RXTAIL)
    local slots = emu:read32(MBOX + MB_RXSLOTS)
    if slots == 0 then return false end
    local nxt = (head + 1) % slots
    if nxt == tail then return false end
    local rxBase = MB_TX + emu:read32(MBOX + MB_TXSLOTS) * EVENT_SIZE
    local a = MBOX + rxBase + head * EVENT_SIZE
    for i = 1, EVENT_SIZE do emu:write8(a + i - 1, b[i]) end
    emu:write32(MBOX + MB_RXHEAD, nxt)
    return true
end

local function palette()
    local t = {}
    for i = 0, 15 do t[#t + 1] = string.format("%X", emu:read16(PAL_TAGS + i * 2)) end
    return "riservate " .. emu:read8(RESERVED) .. " | " .. table.concat(t, " ", 13, 16)
        .. "   (tutte: " .. table.concat(t, " ") .. ")"
end

local frame, dalSpawn, foto = 0, nil, 0
local ultimaPal = nil
local finito = false
local K = C.GBA_KEY

dire("banco Surf caricato" .. (SENZA_ICONA and " (SENZA icona)" or " (con icona LOTTA sull'amico)"))

callbacks:add("frame", function()
    if finito then return end
    frame = frame + 1
    emu:clearKeys(0x3FF)                       -- il giocatore 1 lo guida il banco

    if not dalSpawn then
        if remotoASchermo() then
            dalSpawn = 0
            dire("amico a schermo al frame " .. frame .. " | " .. palette())
        elseif frame > 60 * 120 then
            dire("amico mai comparso"); finito = true
        end
        return
    end
    dalSpawn = dalSpawn + 1
    local t = dalSpawn

    -- lo stato LOTTA dell'amico, ribadito: il suo client manda "overworld"
    if not SENZA_ICONA and t % 20 == 0 then
        local b = ultimoRx()
        if b then
            b[1] = (b[1] & 0xF0) | 5     -- EVENT_STATUS, stesso slot
            b[2] = 1                     -- ST_BATTLE
            deliverRx(b)
        end
    end

    -- i tasti: a t=180 si gira a nord (acqua: non cammina), poi A a impulsi
    if t >= 180 and t < 184 then emu:addKey(K.UP) end
    if t >= 240 and t < 1500 and (t - 240) % 40 < 4 then emu:addKey(K.A) end

    -- le palette: ogni cambiamento, con il frame
    local p = palette()
    if p ~= ultimaPal then
        dire(string.format("t=%4d  %s", t, p))
        ultimaPal = p
    end

    -- foto fitte da quando si preme A
    if t >= 240 and t < 1500 and t % 12 == 0 then
        foto = foto + 1
        pcall(function() emu:screenshot(string.format("%s/surf-%03d.png", DIR, foto)) end)
    end
    if t == 1500 then
        dire("fine: " .. foto .. " foto")
        finito = true
    end
end)
