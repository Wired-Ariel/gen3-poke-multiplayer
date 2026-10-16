-- =============================================================================
-- banco_emote.lua - le emote sopra la testa e la squadra nella scheda
-- (2026-10-16)
-- =============================================================================
--
-- COSA PROVA, nel giocatore 1, col payload VERO e il gioco vero:
--   A. EMOTE DELL'AMICO. Quando il suo avatar e' a schermo il banco scrive
--      nella coda RX del payload (come fa il client con l'emote presa dalla
--      chat) un EVENT_EMOTE per il suo slot: «!», poi «?», poi il cuore.
--      Ognuna deve far salire emotesShown di 1, e la foto la deve mostrare
--      sopra la testa dell'amico.
--   B. LA MIA. Un EVENT_EMOTE col bit 7: il cuore sopra il MIO personaggio.
--   C. UN CODICE FUORI RANGE (dir 5): arriva (emotesRx +1) ma non si mostra.
--   D. LA SQUADRA NELLA SCHEDA. Dopo almeno un giro della scheda partyCards e'
--      salito, e in gTrainerCards[0] i byte della squadra (CARD_PARTY_*)
--      dicono quanti Pokemon ci sono e a che livello, uguali a gPlayerParty
--      (livello in chiaro a +0x54 di ogni struct Pokemon da 100 byte). Le
--      specie vanno lette fuori (il registro di client.py, «[squadra]»): qui
--      si controlla che siano non nulle e non oltre l'uovo.
--   E. LA GUARDIA. Nella scheda dell'amico (gTrainerCards[1 + slot]) i byte
--      +0x54..+0x5F sono a zero anche dopo che i suoi pezzi 12 e 13 sono
--      arrivati: al visore del gioco la squadra non arriva.
--
-- USO: .\tools\prova-in-tre.ps1 -Rom <gioco.gba> -Giocatori 2 -Syms it -Secondi 120 -Banco <...>\mgba\banco_emote.lua
-- Verdetto in build\prova-in-tre\banco_emote.txt, foto emote-*.png accanto.

local BASE = PAYLOAD_BASE or 0x0203CF80
local STAT = BASE + 0x10
local MBOX = BASE + (PAYLOAD_OFF_MAILBOX or 0x200)
local MAGIC_STATE = 0x53544154
local MAGIC_MBOX  = 0x584F424D

-- Offset di PayloadState (tabella S di inject_body.lua).
local PS_OBJECTID     = 0x18
local PS_CARDCHUNKSRX = 0x174
local PS_CARDRXBITMAP = 0x178
local PS_EMOTESRX     = 0x1B4
local PS_EMOTESSHOWN  = 0x1B8
local PS_PARTYCARDS   = 0x1BC

local EVENT_EMOTE = 8

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
local out = io.open(DIR .. "/banco_emote.txt", "w")
local function dire(s)
    console:log("[banco-emote] " .. s)
    if out then out:write(s .. "\n"); out:flush() end
end

if not (A.gObjectEvents and A.gMain and A.gTrainerCards and A.gPlayerParty and A.gPlayerPartyCount) then
    dire("SIMBOLI MANCANTI: servono gObjectEvents, gMain, gTrainerCards, gPlayerParty, gPlayerPartyCount")
    return
end

local function cont(off) return emu:read32(STAT + off) end
local function vblank() return emu:read32(A.gMain + 0x20) end

-- Lo slot dell'amico a schermo (0..2), o nil.
local function amico()
    if emu:read32(STAT) ~= MAGIC_STATE then return nil end
    local id = cont(PS_OBJECTID)
    if id >= 16 then return nil end
    local o = A.gObjectEvents + id * 0x24
    if (emu:read8(o) & 0x01) == 0 then return nil end
    local lid = emu:read8(o + 0x08)
    if lid < 0xE0 or lid > 0xE2 then return nil end
    return lid - 0xE0
end

-- Un EVENT_EMOTE nella coda RX, come lo scrive il client (12 byte a rx[head]).
local function iniettaEmote(slot, dir)
    if emu:read32(MBOX) ~= MAGIC_MBOX then dire("mailbox non trovata"); return false end
    local txSlots = emu:read32(MBOX + 0x0C)
    local head    = emu:read32(MBOX + 0x10)
    local tail    = emu:read32(MBOX + 0x14)
    local slots   = emu:read32(MBOX + 0x18)
    local nuovo   = (head + 1) % slots
    if nuovo == tail then dire("coda RX piena"); return false end
    local a = MBOX + 0x20 + txSlots * 12 + head * 12
    local b = { EVENT_EMOTE + slot * 16, dir, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }
    for i = 1, 12 do emu:write8(a + i - 1, b[i]) end
    emu:write32(MBOX + 0x10, nuovo)
    return true
end

local function foto(nome)
    local p = ("%s/emote-%s.png"):format(DIR, nome)
    local ok = pcall(function() emu:screenshot(p) end)
    dire(("foto %s: %s"):format(p, ok and "ok" or "FALLITA"))
end

local esiti = {}
local function giudica(nome, ok, dettaglio)
    esiti[#esiti + 1] = ok
    dire(("%s: %s  (%s)"):format(nome, ok and "OK" or "NO", dettaglio))
end

-- I passi: {nome, slot o "io", dir}. Fra uno e l'altro 120 frame: l'icona del
-- gioco rimbalza e si spegne da sola in meno di un secondo.
local passi = {
    { "A-esclamativo", nil, 0 },
    { "A-interrogativo", nil, 1 },
    { "A-cuore", nil, 2 },
    { "B-cuore-mio", "io", 0x82 },
    { "C-fuori-range", nil, 5 },
}
local fase, i, t0, mostrate0, arrivate0 = "ATTESA", 1, 0, 0, 0
local slotAmico = nil
local finito = false

local function squadraDallaScheda(base)
    local mons = {}
    for k = 0, 5 do
        local sp = emu:read16(base + 0x54 + k * 2)
        if sp ~= 0 then mons[#mons + 1] = { sp = sp, lv = emu:read8(base + 0x44 + k) } end
    end
    return mons, emu:read8(base + 0x4A), emu:read8(base + 0x4B)
end

local function verificaSquadra()
    local giri = cont(PS_PARTYCARDS)
    local mons, cromatici, esausti = squadraDallaScheda(A.gTrainerCards)
    local n = emu:read8(A.gPlayerPartyCount)
    local livelliOk, specieOk = (#mons == n), true
    local righe = {}
    for k = 1, #mons do
        local veroLv = emu:read8(A.gPlayerParty + (k - 1) * 100 + 0x54)
        if mons[k].lv ~= veroLv then livelliOk = false end
        if mons[k].sp > 412 then specieOk = false end
        righe[#righe + 1] = ("#%d lv%d (vero lv%d)"):format(mons[k].sp, mons[k].lv, veroLv)
    end
    giudica("D-squadra-nella-scheda", giri > 0 and livelliOk and specieOk and n > 0,
        ("partyCards %d | %d Pokemon nella scheda, %d in squadra | %s | cromatici %02X esausti %02X")
        :format(giri, #mons, n, table.concat(righe, ", "), cromatici, esausti))

    local suaBase = A.gTrainerCards + 0x64 * (1 + (slotAmico or 0))
    local bitmap = cont(PS_CARDRXBITMAP)
    local zeri = true
    for k = 0x54, 0x5F do if emu:read8(suaBase + k) ~= 0 then zeri = false end end
    local pezzi = ((bitmap >> 12) & 3) == 3
    giudica("E-guardia-scheda-amico", pezzi and zeri,
        ("pezzi 12 e 13 arrivati: %s (bitmap %04X, chunk ricevuti %d) | +0x54..+0x5F a zero: %s")
        :format(pezzi and "si'" or "NO", bitmap, cont(PS_CARDCHUNKSRX), zeri and "si'" or "NO"))
end

local function tick()
    if finito then return end
    local ora = vblank()
    local slot = amico()

    if fase == "ATTESA" then
        if slot then
            slotAmico = slot
            dire(("amico a schermo: slot %d"):format(slot))
            fase, t0 = "INIETTA", ora + 60
        end
        return
    end

    if fase == "INIETTA" then
        if ora < t0 then return end
        -- L'icona sta 16 pixel sopra la testa e rimbalza: con l'amico a meno
        -- di tre tile dal bordo alto finisce fuori dalla foto (e' successo al
        -- «!» del primo giro). Si aspetta che sia ben dentro lo schermo, al
        -- massimo 10 s; la mia emote guarda me, che la camera tiene al centro.
        if passi[i][2] ~= "io" and slotAmico and A.gPlayerAvatar and ora < t0 + 600 then
            local io = A.gObjectEvents + emu:read8(A.gPlayerAvatar + 0x05) * 0x24
            local lui = A.gObjectEvents + cont(PS_OBJECTID) * 0x24
            local dy = emu:read16(lui + 0x12) - emu:read16(io + 0x12)
            if dy < -2 or dy > 3 then return end
        end
        local p = passi[i]
        mostrate0, arrivate0 = cont(PS_EMOTESSHOWN), cont(PS_EMOTESRX)
        if iniettaEmote(p[2] == "io" and 0 or slotAmico, p[3]) then
            fase, t0 = "FOTO", ora + 10
        end
        return
    end

    if fase == "FOTO" then
        if ora < t0 then return end
        foto(passi[i][1])
        fase, t0 = "GIUDICA", ora + 110
        return
    end

    if fase == "GIUDICA" then
        if ora < t0 then return end
        local p = passi[i]
        local mostrate, arrivate = cont(PS_EMOTESSHOWN) - mostrate0, cont(PS_EMOTESRX) - arrivate0
        local atteso = (p[3] & 0x7F) < 3 and 1 or 0
        giudica(p[1], arrivate == 1 and mostrate == atteso,
            ("emotesRx +%d, emotesShown +%d (atteso +%d)"):format(arrivate, mostrate, atteso))
        i = i + 1
        if i <= #passi then
            fase, t0 = "INIETTA", ora + 10
            return
        end
        fase, t0 = "SQUADRA", ora + 600      -- almeno un giro intero della scheda
        return
    end

    if fase == "SQUADRA" then
        if ora < t0 then return end
        verificaSquadra()
        local ok = 0
        for _, e in ipairs(esiti) do if e then ok = ok + 1 end end
        dire(("VERDETTO: %d su %d"):format(ok, #esiti))
        finito = true
    end
end

callbacks:add("frame", tick)
dire("banco delle emote caricato: aspetto l'amico a schermo")
