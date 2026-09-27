-- =============================================================================
-- banco_stub.lua - lo stub multiboot VERO, eseguito in mGBA (2026-09-27)
-- =============================================================================
--
-- PERCHE'. handoff_test.lua prova handoff.S imitando lo stub in Lua. Lo stub
-- UNIVERSALE (hw/mbstub/build.ps1 -Syms tutte) ha logica nuova in C - quale
-- lingua e' la cartuccia, quali parole ricucire - e quella va provata nel
-- binario vero, non in una copia. mGBA non sa fare il multiboot con la
-- cartuccia inserita a caldo, ma si puo' fare il contrario: gioco gia' acceso,
-- lo stub scritto dove lo metterebbe il BIOS (0x02000000) e fatto partire al
-- primo interrupt da un trampolino ARM che spegne IME (come il BIOS) e salta a
-- 0x020000C0. Da li' in poi e' tutto codice dello stub: legge la cartuccia,
-- sceglie la lingua, copia il payload, ricuce, handoff.S, AgbMain.
--
-- CRITERI (tutti numeri):
--   S-1  i colori dello stub: prima ROSSO, poi VERDE (backdrop a 0x05000000),
--        mai BLU, CIANO o MAGENTA. Il GIALLO dura meno di un frame (azzera e
--        copia 13 KB) e il banco legge una volta a frame: non si pretende -
--        la prima versione lo pretendeva e dava NO a uno stub che funzionava;
--   S-2  dopo l'handoff il vettore IRQ vale PAYLOAD_BASE e il magic 'STAT' c'e';
--   S-3  le 50 parole ricucite in EWRAM sono quelle del payload della LINGUA
--        della cartuccia (confronto col payload-<lingua>.bin compilato);
--   S-4  premendo A si rientra in partita e il payload RICONOSCE l'overworld
--        (inOverworld = 1, bodyTicks sale): se l'indirizzo di CB2_Overworld
--        non fosse stato ricucito per questa lingua, resterebbe 0.
--
-- USO (lo lancia a mano chi prova; boot d'esempio in docs\prove):
--   BANCO_STUB   = percorso di hw/mbstub/build/mbstub.gba
--   BANCO_ATTESO = percorso di hw/mbstub/build/payload-<lingua>.bin
--   BANCO_LINGUA = "it" oppure "usa"
--   BANCO_DIR    = cartella per verdetto e foto
--   mGBA.exe --script boot.lua <rom con un .sav in partita accanto>

local LINGUA = BANCO_LINGUA or "it"
local DIR = BANCO_DIR or "."
local CB2_OW = ({ it = 0x08085E70, usa = 0x08085E5C })[LINGUA]
local GMAIN_CB2 = 0x030022C4
local IRQ_VECTOR = 0x03007FFC
local PAYLOAD_BASE = 0x0203CF80
local STAT = PAYLOAD_BASE + 0x10
local TRAMP = 0x0203FF80
local TRAMP_BYTES = "\x0c\x00\x9f\xe5\x00\x10\xa0\xe3\xb0\x10\xc0\xe1\x04\x00\x9f\xe5"
                 .. "\x10\xff\x2f\xe1\x08\x02\x00\x04\xc0\x00\x00\x02"
-- PayloadState: inOverworld e bodyTicks (mgba/inject_body.lua, tabella S)
local PS_INOVERWORLD, PS_BODYTICKS = 0x10, 0x188

local out = io.open(DIR .. "/banco_stub.txt", "w")
local function dire(s)
    console:log("[stub] " .. s)
    if out then out:write(s .. "\n"); out:flush() end
end

local function leggiFile(p)
    local f = io.open(p, "rb"); if not f then return nil end
    local d = f:read("a"); f:close(); return d
end
local stub, atteso = leggiFile(BANCO_STUB or ""), leggiFile(BANCO_ATTESO or "")
if not stub or not atteso then dire("MANCANO I FILE: BANCO_STUB / BANCO_ATTESO"); return end
dire(string.format("lingua %s, stub %d byte, payload atteso %d byte", LINGUA, #stub, #atteso))

local NOMI = { [0x001F] = "ROSSO", [0x03FF] = "GIALLO", [0x03E0] = "VERDE",
               [0x7C00] = "BLU", [0x7FE0] = "CIANO", [0x7C1F] = "MAGENTA" }
local K = C.GBA_KEY
local fase, frame, t0 = "ENTRA", 0, 0
local colori, ultimoColore = {}, nil
local foto = 0
local vbPrima = nil

local function inOverworld()
    return (emu:read32(GMAIN_CB2) & 0xFFFFFFFE) == (CB2_OW & 0xFFFFFFFE)
end
local function premiA(t) emu:clearKeys(0x3FF); if t % 20 < 6 then emu:addKey(K.A) end end
local function scatta(nome)
    foto = foto + 1
    pcall(function() emu:screenshot(string.format("%s/stub-%s-%02d-%s.png", DIR, LINGUA, foto, nome)) end)
end

callbacks:add("frame", function()
    frame = frame + 1
    if fase == "ENTRA" then
        premiA(frame)
        if inOverworld() then t0 = t0 + 1 else t0 = 0 end
        -- BANCO_SUBITO: la controprova con una cartuccia che NON e' Smeraldo
        -- (non ha un overworld da aspettare): si spara al frame indicato.
        if BANCO_SUBITO and frame >= BANCO_SUBITO then t0 = 120 end
        if t0 >= 120 then
            emu:clearKeys(0x3FF)
            for i = 1, #TRAMP_BYTES do emu:write8(TRAMP + i - 1, TRAMP_BYTES:byte(i)) end
            for i = 1, #stub do emu:write8(0x02000000 + i - 1, stub:byte(i)) end
            emu:write32(IRQ_VECTOR, TRAMP)
            dire("in partita da 2 s: stub scritto a 0x02000000, vettore IRQ sul trampolino")
            fase, t0 = "STUB", 0
        elseif frame > 60 * 40 then
            dire("NON sono entrato in partita in 40 s"); fase = "FINE"
        end
        return
    end
    if fase == "STUB" then
        t0 = t0 + 1
        local c = emu:read16(0x05000000) & 0x7FFF
        local nome = NOMI[c]
        if nome and nome ~= ultimoColore then
            colori[#colori + 1] = nome; ultimoColore = nome
            dire(string.format("t=%d colore dello stub: %s", t0, nome)); scatta(nome)
        end
        if emu:read32(IRQ_VECTOR) == PAYLOAD_BASE and emu:read32(STAT) == 0x53544154 then
            -- S-3: le parole ricucite, lette dalla EWRAM vera
            local diverse, controllate = 0, 0
            for o = 0, #atteso - 4, 4 do
                local w = string.unpack("<I4", atteso, o + 1)
                if (w >> 24) == 0x08 then
                    controllate = controllate + 1
                    if emu:read32(PAYLOAD_BASE + o) ~= w then diverse = diverse + 1 end
                end
            end
            dire(string.format("handoff fatto a t=%d: vettore IRQ = PAYLOAD_BASE, STAT presente", t0))
            dire(string.format("S-3 parole-indirizzo ROM del payload: %d controllate, %d DIVERSE da payload-%s.bin",
                controllate, diverse, LINGUA))
            S3 = (diverse == 0)
            fase, t0 = "RIENTRA", 0
        elseif t0 > 60 * 15 then
            dire("lo stub non ha passato la mano in 15 s (colori visti: " .. table.concat(colori, " > ") .. ")")
            if BANCO_SUBITO then
                -- controprova: e' proprio quello che deve succedere, se il colore e' rimasto ROSSO
                local soloRosso = (#colori == 1 and colori[1] == "ROSSO")
                dire("CONTROPROVA: cartuccia non riconosciuta, stub fermo sul ROSSO: " .. (soloRosso and "OK" or "NO"))
            end
            fase = "FINE"
        end
        return
    end
    if fase == "RIENTRA" then
        t0 = t0 + 1
        premiA(t0)
        if inOverworld() then
            if not vbPrima then vbPrima = { t0, emu:read32(STAT + PS_BODYTICKS) } end
            if t0 - vbPrima[1] >= 120 then
                emu:clearKeys(0x3FF)
                local inOw = emu:read32(STAT + PS_INOVERWORLD)
                local dt = emu:read32(STAT + PS_BODYTICKS) - vbPrima[2]
                scatta("partita")
                local sequenza = table.concat(colori, " > ")
                local rifiuti = sequenza:find("BLU") or sequenza:find("CIANO") or sequenza:find("MAGENTA")
                local S1 = (colori[1] == "ROSSO" and colori[#colori] == "VERDE" and not rifiuti)
                local S4 = (inOw == 1 and dt > 60)
                dire("S-1 colori: " .. sequenza .. (S1 and "  OK" or "  NO"))
                dire("S-2 vettore e STAT: OK")
                dire("S-3 ricucitura per " .. LINGUA .. ": " .. (S3 and "OK" or "NO"))
                dire(string.format("S-4 il payload riconosce l'overworld: inOverworld %d, bodyTicks +%d in 2 s  %s",
                    inOw, dt, S4 and "OK" or "NO"))
                dire((S1 and S3 and S4) and "VERDETTO: OK" or "VERDETTO: FALLITO")
                fase = "FINE"
            end
        elseif t0 > 60 * 60 then
            dire("dopo l'handoff non sono rientrato in partita in 60 s"); fase = "FINE"
        end
        return
    end
end)

dire("banco stub caricato")
