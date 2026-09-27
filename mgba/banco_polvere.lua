-- =============================================================================
-- banco_polvere.lua - gli effetti a terra trovano la loro palette? (2026-09-27)
-- =============================================================================
--
-- PERCHE'. Dopo banco_surf.lua la domanda di Lain: «succede anche con altro,
-- tipo la sabbia?». In overworld gli slot palette liberi sono quattro (12-15):
-- il meteo ne tiene due (0x1200/0x1201), gli effetti a terra gli altri due
-- (FLDEFF_PAL_TAG_GENERAL_0 0x1004 = sabbia, schizzi, polvere, pozzanghere,
-- tracce della bici, bolle; GENERAL_1 0x1005 = erba, increspature, cenere).
-- Se un nostro tag ne occupa uno, uno dei due gruppi non trova posto.
--
-- SCENA: la stessa di banco_surf.lua (Percorso 110, amico nell'erba, quindi
-- 0x1005 caricata, icona LOTTA sopra di lui). L'amico SALTA sul posto 14 volte
-- (MOVEMENT_ACTION_JUMP_IN_PLACE_DOWN, scritto come ObjectEventSetHeldMovement):
-- all'atterraggio il gioco vuole la polvere, palette 0x1004.
--
-- CRITERIO: "0x1004 mai caricata: false" (cioe' caricata ai salti) CON l'icona.
-- Braccio di controllo: BANCO_SENZA_ICONA = true prima del dofile.
-- Riga per riga: palette 12-15 e VRAM degli sprite (tile liberi, buco max).
--
-- USO: .\tools\prova-in-tre.ps1 -Rom <...>\build\banco-surf\gioco.gba -Giocatori 2 -Syms it -Banco <...>\mgba\banco_polvere.lua
-- Uscita: build\prova-in-tre\banco_polvere.txt + polvere-NNN.png

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
local out = io.open(DIR .. "/banco_polvere.txt", "w")
local function dire(s)
    console:log("[polvere] " .. s)
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

-- La VRAM degli sprite: sSpriteTileAllocBitmap (EWRAM_DATA static di sprite.c,
-- 0x02021B3C: literal pool di FreeSpriteTilesByTag, uguale nelle due ROM),
-- 1024 bit, dopo gReservedSpriteTileCount (0x02021B3A). Il Pokemon della MN
-- vuole 64 tile CONTIGUI (CreatePicSprite -> AllocSpriteTiles).
local TILE_BITMAP, TILE_RESERVED = 0x02021B3C, 0x02021B3A
local function vram()
    local liberi, run, maxrun = 0, 0, 0
    for n = emu:read16(TILE_RESERVED), 1023 do
        local occ = (emu:read8(TILE_BITMAP + (n >> 3)) >> (n & 7)) & 1
        if occ == 0 then
            liberi = liberi + 1; run = run + 1
            if run > maxrun then maxrun = run end
        else
            run = 0
        end
    end
    return liberi, maxrun
end
minBuco = 9999

local function palette()
    local t = {}
    for i = 0, 15 do t[#t + 1] = string.format("%X", emu:read16(PAL_TAGS + i * 2)) end
    local liberi, buco = vram()
    if buco < minBuco then minBuco = buco end
    return "riservate " .. emu:read8(RESERVED) .. " | " .. table.concat(t, " ", 13, 16)
        .. " | VRAM libera " .. liberi .. " tile, buco max " .. buco
        .. "   (tutte: " .. table.concat(t, " ") .. ")"
end

local frame, dalSpawn, foto = 0, nil, 0
local salti, visto1004, ultimoSalto = 0, false, 0
local ultimaPal = nil
local finito = false
local K = C.GBA_KEY

dire("banco polvere caricato" .. (SENZA_ICONA and " (SENZA icona)" or " (con icona LOTTA sull'amico)"))

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
    -- l'amico salta sul posto (polvere all'atterraggio = FLDEFF_PAL_TAG_GENERAL_0 0x1004)
    if t >= 240 and t < 1500 and t - (ultimoSalto or 0) >= 90 then
        local id = emu:read32(STAT + PS_OBJECTID)
        local o = oe(id)
        local f0 = emu:read8(o)
        local spr = emu:read8(o + 0x04)
        local occupato = (f0 & 0x40) ~= 0 and (f0 & 0x80) == 0
        if not occupato and spr < 64 then
            ultimoSalto = t
            emu:write8(o + 0x1C, 0x46)
            emu:write8(o, (f0 | 0x40) & 0x7F)
            emu:write16(A.gSprites + spr * 0x44 + 0x32, 0)
            salti = (salti or 0) + 1
        end
    end

    -- le palette: ogni cambiamento, con il frame
    local p = palette()
    for i = 12, 15 do if emu:read16(PAL_TAGS + i * 2) == 0x1004 then visto1004 = true end end
    if p ~= ultimaPal then
        dire(string.format("t=%4d  %s", t, p))
        ultimaPal = p
    end

    -- foto fitte da quando si preme A
    if t >= 240 and t < 1500 and t % 6 == 0 then
        foto = foto + 1
        pcall(function() emu:screenshot(string.format("%s/polvere-%03d.png", DIR, foto)) end)
    end
    if t == 1500 then
        dire("buco VRAM minimo visto: " .. minBuco .. " tile (servono 64)")
        dire("fine: " .. foto .. " foto, salti " .. tostring(salti) .. ", 0x1004 mai caricata: " .. tostring(not visto1004))
        finito = true
    end
end)
