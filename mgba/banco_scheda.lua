-- =============================================================================
-- banco_scheda.lua - la scheda dell'amico si apre, e si richiude, su una ROM
-- inglese? (2026-09-27)
-- =============================================================================
--
-- IL DUBBIO. Il payload apre la scheda dell'amico con ShowTrainerCardInLink,
-- dopo aver scritto LANGUAGE_ITALIAN in gLinkPlayers[1 + slot] (main.c, cerca
-- "LANGUAGE_ITALIAN"): costante fissa, anche nella build USA. Nel sorgente la
-- lingua serve solo a ConvertInternationalString, che cambia qualcosa SOLO per
-- il giapponese (string_util.c:739) - quindi dovrebbe essere innocuo. Ma
-- nessuno ha mai aperto la scheda di un amico su una cartuccia inglese, e i
-- giocatori della community ce l'hanno: meglio vederla prima loro.
--
-- COME LA PROVOCA. I due giocatori partono dallo stesso salvataggio, quindi
-- dalla stessa casella; il giocatore 2 (autopilota, asse orizzontale) passa
-- avanti e indietro sulla riga del giocatore 1. Il banco, nel giocatore 1:
--   1. lo tiene FERMO e lo gira verso EST (un tocco breve = girarsi, non
--      camminare; il pass-through rende la casella percorribile, quindi il
--      tocco deve restare corto e il banco controlla che non si sia mosso);
--   2. aspetta la scheda COMPLETA (cardRxBitmap = 0x3FFF);
--   3. quando l'avatar dell'amico e' esattamente sulla casella a est, preme A;
--   4. se cardShows sale, fotografa la scheda (fronte), poi A per girarla e
--      fotografa il retro, poi B finche' non si torna in overworld;
--   5. controlla che il corpo del payload giri ancora (bodyTicks).
--
-- CRITERIO: SCHEDE_VOLUTE aperture (cardShows +N), rientro in overworld dopo
-- ognuna, bodyTicks che sale dopo l'ultima, e le foto da guardare.
--
-- USO: .\tools\prova-in-tre.ps1 -Rom <emerald-usa.gba> -Syms usa -Giocatori 2 -Banco <...>\mgba\banco_scheda.lua
-- Verdetto in build\prova-in-tre\banco_scheda.txt, foto scheda-*.png accanto.

local BASE = PAYLOAD_BASE or 0x0203CF80
local STAT = BASE + 0x10
local MAGIC_STATE = 0x53544154

-- Offset di PayloadState (tabella S di inject_body.lua).
local PS_OBJECTID     = 0x18
local PS_CARDRXBITMAP = 0x178
local PS_CARDSHOWS    = 0x17C
local PS_ABLOCKED     = 0xC0
local PS_BODYTICKS    = 0x188

local SCHEDE_VOLUTE = 2
local DIR_EAST = 4
local K = C.GBA_KEY

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
local out = io.open(DIR .. "/banco_scheda.txt", "w")
local function dire(s)
    console:log("[scheda] " .. s)
    if out then out:write(s .. "\n"); out:flush() end
end

if not (A.gObjectEvents and A.gPlayerAvatar and A.gMain and A.CB2_Overworld) then
    dire("SIMBOLI MANCANTI: servono gObjectEvents, gPlayerAvatar, gMain, CB2_Overworld")
    return
end

local function oe(i) return A.gObjectEvents + i * 0x24 end
local function cont(off) return emu:read32(STAT + off) end
local function inOverworld()
    return (emu:read32(A.gMain + 0x04) & 0xFFFFFFFE) == (A.CB2_Overworld & 0xFFFFFFFE)
end
local function premi(tasto)
    emu:clearKeys(0x3FF)
    if tasto then emu:addKey(tasto) end
end

local function codiceGioco()
    local s = ""
    for i = 0, 3 do s = s .. string.char(emu:read8(0x080000AC + i)) end
    return s
end

local function slotRemoto()
    if emu:read32(STAT) ~= MAGIC_STATE then return nil end
    local id = cont(PS_OBJECTID)
    if id >= 16 then return nil end
    local o = oe(id)
    if (emu:read8(o) & 0x01) == 0 then return nil end
    local lid = emu:read8(o + 0x08)
    if lid < 0xE0 or lid > 0xE2 then return nil end
    return id
end

local function giocatore()
    local pid = emu:read8(A.gPlayerAvatar + 0x05)   -- gPlayerAvatar.objectEventId
    if pid >= 16 then return nil end
    local o = oe(pid)
    return emu:read16(o + 0x10), emu:read16(o + 0x12), emu:read8(o + 0x18) & 0x0F
end

local function foto(nome)
    local p = ("%s/scheda-%s.png"):format(DIR, nome)
    local ok = pcall(function() emu:screenshot(p) end)
    dire(("foto %s: %s"):format(p, ok and "ok" or "FALLITA"))
end

-- stato: GIRA -> ASPETTA -> PREMUTO -> APERTA -> CHIUDI -> ASPETTA ... -> FINE
local stato, t, frame = "GIRA", 0, 0
local aperte, mancate = 0, 0
local showsIniziali, blockedIniziali = nil, nil
local xy0 = nil
local mosso = false
local rientri = 0
local finito = false
local dopo, bodyAlVerdetto = 0, 0

local function verdetto()
    finito = true
    bodyAlVerdetto = cont(PS_BODYTICKS)
    dire(("ROM                      %s"):format(codiceGioco()))
    dire(("schede aperte            %d (cardShows +%d)"):format(aperte, cont(PS_CARDSHOWS) - (showsIniziali or 0)))
    dire(("A senza scheda           %d (aBlocked +%d)"):format(mancate, cont(PS_ABLOCKED) - (blockedIniziali or 0)))
    dire(("rientri in overworld     %d"):format(rientri))
    dire(("giocatore locale fermo   %s"):format(mosso and "NO" or "si'"))
    if aperte >= SCHEDE_VOLUTE and rientri >= aperte and not mosso then
        dire("VERDETTO (parziale): OK - aperta e richiusa; manca il battito di bodyTicks, sotto")
    else
        dire("VERDETTO: FALLITO")
    end
end

callbacks:add("frame", function()
    if finito then
        premi(nil)
        dopo = dopo + 1
        if dopo == 240 then
            local b = cont(PS_BODYTICKS)
            dire(("battito +240 frame: bodyTicks %d -> %d %s"):format(bodyAlVerdetto, b,
                b > bodyAlVerdetto and "(il corpo gira: OK)" or "(FERMO: FALLITO)"))
        end
        return
    end
    frame = frame + 1
    t = t + 1
    if frame > 60 * 240 then dire("tempo scaduto (4 min) in stato " .. stato); verdetto(); return end

    if stato == "GIRA" or stato == "ASPETTA" then
        local px, py, dir = giocatore()
        if not px then premi(nil); return end
        if xy0 == nil then
            xy0 = { px, py }
            showsIniziali = cont(PS_CARDSHOWS)
            blockedIniziali = cont(PS_ABLOCKED)
            dire(("ROM %s, giocatore a (%d,%d) dir %d"):format(codiceGioco(), px, py, dir))
        end
        if px ~= xy0[1] or py ~= xy0[2] then
            if not mosso then dire(("ATTENZIONE: il giocatore si e' mosso a (%d,%d)"):format(px, py)) end
            mosso = true
        end

        if stato == "GIRA" then
            -- Un tocco di 2 frame gira senza camminare; poi 30 frame di calma.
            if dir == DIR_EAST and t > 30 then
                dire("girato verso est, aspetto l'amico")
                stato, t = "ASPETTA", 0
            elseif t <= 2 and dir ~= DIR_EAST then
                premi(K.RIGHT)
            else
                premi(nil)
                if t > 60 then t = 0 end   -- non si e' girato: si ritocca
            end
            return
        end

        premi(nil)
        local id = slotRemoto()
        if not id then
            if t % 600 == 0 then dire(("frame %d: amico non a schermo"):format(frame)) end
            return
        end
        local bm = cont(PS_CARDRXBITMAP)
        if bm ~= 0x3FFF then
            if t % 600 == 0 then dire(("frame %d: scheda incompleta (0x%04X)"):format(frame, bm)) end
            return
        end
        if dir ~= DIR_EAST then stato, t = "GIRA", 0; return end
        local o = oe(id)
        local rx, ry = emu:read16(o + 0x10), emu:read16(o + 0x12)
        if rx == px + 1 and ry == py then
            dire(("frame %d: amico a est (%d,%d), premo A"):format(frame, rx, ry))
            stato, t = "PREMUTO", 0
        end
        return
    end

    if stato == "PREMUTO" then
        if t <= 4 then premi(K.A) else premi(nil) end
        if cont(PS_CARDSHOWS) - showsIniziali > aperte then
            aperte = aperte + 1
            dire(("frame %d: cardShows sale -> scheda %d aperta"):format(frame, aperte))
            stato, t = "APERTA", 0
        elseif t > 120 then
            mancate = mancate + 1
            dire(("frame %d: A premuto ma nessuna scheda (amico passato oltre?)"):format(frame))
            stato, t = "ASPETTA", 0
        end
        return
    end

    if stato == "APERTA" then
        -- Il viewer ha la sua dissolvenza d'ingresso: le foto aspettano.
        if t == 150 then foto(aperte .. "-fronte") end
        if t >= 170 and t <= 174 then premi(K.A) else premi(nil) end   -- gira la scheda
        if t == 300 then foto(aperte .. "-retro") end
        if t > 320 then stato, t = "CHIUDI", 0 end
        return
    end

    if stato == "CHIUDI" then
        -- B chiude la scheda; si torna col menu START aperto (il cb2 di rientro
        -- e' CB2_ReturnToFieldWithOpenMenu), quindi B ancora per chiuderlo.
        if t % 30 < 4 then premi(K.B) else premi(nil) end
        if t == 200 then foto(aperte .. "-rientro") end
        if t > 240 then
            if inOverworld() then
                rientri = rientri + 1
                dire(("frame %d: di nuovo in overworld"):format(frame))
            else
                dire(("frame %d: NON sono tornato in overworld (cb2 0x%08X)"):format(frame, emu:read32(A.gMain + 0x04)))
            end
            if aperte >= SCHEDE_VOLUTE then verdetto() else stato, t = "GIRA", 0 end
        end
        return
    end
end)

dire("banco scheda caricato")
