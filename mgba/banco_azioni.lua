-- =============================================================================
-- banco_azioni.lua - TUTTE le azioni e le pose, date al remoto una per una
--                    (2026-10-10)
-- =============================================================================
--
-- COSA PROVA. Dal 2026-10-10 il byte `speed` del NetEvent porta la movement
-- action del mittente (o una posa, o il volo) e chi riceve la da' al remoto
-- cosi' com'e'. Il pericolo di quel disegno e' uno solo e si chiama animNum:
-- ogni grafica ha una tabella di animazioni di lunghezza diversa (1 la mossa di
-- campo, 12 la pesca, 20 la bici da corsa, 24 a piedi, 40 la bici acrobatica),
-- e un'azione che chiede un'animazione oltre la fine fa leggere al gioco un
-- comando spazzatura e copiare in VRAM un pezzo di memoria a caso.
--
-- Questo banco NON ha un amico vero: l'iniettore e' compilato con -LinkRole off
-- e gli eventi li scrive il banco nella mailbox RX, uno per uno, per TUTTI gli
-- stati (0..7) e TUTTI i codici (0x00..0xFF), come PASSO e come GIRA.
--
-- CRITERI (numeri, guardati A OGNI FRAME, non solo alla fine):
--   A1  animNum dello sprite del remoto < voci della tabella della sua grafica;
--   A2  il remoto non esegue mai un'azione fuori dall'elenco di quelle di un
--       giocatore;
--   A3  la palette dello slot 0 (il giocatore LOCALE) non cambia mai, nemmeno
--       con l'amico dell'altro sesso che pesca o annaffia;
--   A4  copertura: quante azioni DIVERSE il remoto ha davvero eseguito per
--       stato (se resta a zero il banco non sta provando niente).
--
--   AZ_DIR     cartella di uscita            AZ_INJECT  inject.<nome>.lua (ruolo off)
--   AZ_OE0     gObjectEvents                 AZ_SPR0    gSprites
--   AZ_CB2     CB2_Overworld (senza Thumb)   AZ_VELOCE  true = solo le famiglie

local DIR = AZ_DIR or "."
local OE0, SPR0, CB2_OW = AZ_OE0, AZ_SPR0, AZ_CB2
local GMAIN, SB1PTR = 0x030022C0, 0x03005D8C
local K_A = 1
local ANIM = { [0] = 24, 20, 40, 24, 20, 1, 12, 20 }
local NOME = { [0] = "a piedi", "bici corsa", "bici acro", "surf", "sott'acqua", "mossa di campo", "pesca", "annaffiatoio" }

local out = io.open(DIR .. "/banco_azioni.txt", "w")
local function dire(s) out:write(s .. "\n"); out:flush(); console:log("[azioni] " .. s) end

local function lecita(a)
    return a <= 0x0F or (a >= 0x15 and a <= 0x38) or (a >= 0x3A and a <= 0x3D)
        or (a >= 0x42 and a <= 0x4D) or (a >= 0x64 and a <= 0x8B) or a == 0xFF
end

local BASE, STAT, MBOX
local function cb2() return emu:read32(GMAIN + 4) & 0xFFFFFFFE end
local function remoto()
    local id = emu:read32(STAT + 0x18)
    if id >= 16 then return nil end
    local o = OE0 + id * 0x24
    if (emu:read8(o) & 1) == 0 or emu:read8(o + 8) ~= 0xE0 then return nil end
    return o
end

local seq = 0
local function manda(kind, dir, code, x, y, gender, stato)
    local head, tail, slots = emu:read32(MBOX + 0x10), emu:read32(MBOX + 0x14), emu:read32(MBOX + 0x18)
    local nxt = (head + 1) % slots
    if nxt == tail then return false end
    local a = MBOX + 0x20 + emu:read32(MBOX + 0x0C) * 12 + head * 12
    local sb1 = emu:read32(SB1PTR)
    seq = (seq + 1) % 256
    local b = { kind, dir, code, seq, emu:read8(sb1 + 4), emu:read8(sb1 + 5),
                x & 0xFF, (x >> 8) & 0xFF, y & 0xFF, (y >> 8) & 0xFF, gender, stato }
    for i = 1, 12 do emu:write8(a + i - 1, b[i]) end
    emu:write32(MBOX + 0x10, nxt)
    return true
end

local function palette0()
    local s = 0
    for i = 0, 15 do s = (s * 31 + emu:read16(0x05000200 + 2 * i)) % 4294967296 end
    return s
end

-- la lista dei codici per uno stato: tutti, oppure solo le famiglie + un po' di fuori elenco
local function codici(tutti)
    local l = {}
    for c = 0, 255 do
        if tutti or lecita(c) or c == 0x10 or c == 0x39 or c == 0x54 or c == 0x56 or c == 0x8C
            or c == 0x9C or c == 0x9E or c == 0xBF or c >= 0xC0 then
            l[#l + 1] = c
        end
    end
    return l
end

local stato, dalla, frame = "SBLOCCA", 0, 0
local s, lista, i, modo = -1, nil, 0, 1          -- stato avatar, lista codici, indice, 1 = GIRA 2 = PASSO
local hx, hy, genere, pal0 = 0, 0, 0, 0
local viste, falliti, ultimoAct = {}, 0, 0xFF
local errA1, errA2, errA3, applicati = 0, 0, 0, 0
local attesa = 0

local function fine(msg)
    dire(""); dire(msg)
    local f = io.open(DIR .. "/FINE", "w"); f:write(msg); f:close()
    emu:setKeys(0); stato = "FINE"
end

local function controlla()
    local o = remoto()
    if not o then return end
    local spr = SPR0 + emu:read8(o + 4) * 0x44
    local an = emu:read8(spr + 0x2A)
    if s >= 0 and an >= ANIM[s] and dalla > 30 then
        errA1 = errA1 + 1
        if errA1 <= 12 then
            dire(("  A1! stato %d (%s) codice %02X modo %d: animNum %d su %d"):format(s, NOME[s], lista and lista[i] or 0, modo, an, ANIM[s]))
        end
    end
    local act = emu:read8(o + 0x1C)
    if act ~= ultimoAct then
        ultimoAct = act
        if act ~= 0xFF then
            applicati = applicati + 1
            viste[act] = true
            if not lecita(act) then
                errA2 = errA2 + 1
                dire(("  A2! stato %d: il remoto esegue l'azione %02X (codice mandato %02X)"):format(s, act, lista and lista[i] or 0))
            end
        end
    end
    if palette0() ~= pal0 then
        errA3 = errA3 + 1
        if errA3 <= 6 then dire(("  A3! la palette del giocatore e' cambiata (stato %d, codice %02X)"):format(s, lista and lista[i] or 0)) end
        pal0 = palette0()
    end
end

callbacks:add("frame", function()
    frame = frame + 1; dalla = dalla + 1
    if stato == "FINE" then return end
    if frame > 60 * 60 * 45 then fine("KO  TEMPO SCADUTO in " .. stato); return end

    if stato == "SBLOCCA" then
        emu:setKeys((dalla % 20 < 8) and K_A or 0)
        if cb2() == CB2_OW and dalla > 120 then emu:setKeys(0); stato, dalla = "CARICA", 0 end
        if dalla > 3600 then fine("KO  non sono entrato in partita") end
        return
    end
    if stato == "CARICA" then
        if dalla < 30 then return end
        local ok, err = pcall(dofile, AZ_INJECT)
        if not ok then fine("KO  iniezione fallita: " .. tostring(err)); return end
        BASE = PAYLOAD_BASE; STAT = BASE + 0x10; MBOX = BASE + PAYLOAD_OFF_MAILBOX
        stato, dalla = "PRONTO", 0
        return
    end
    if stato == "PRONTO" then
        if dalla < 90 then return end
        if emu:read32(STAT) ~= 0x53544154 or emu:read32(MBOX) ~= 0x584F424D then fine("KO  payload non trovato"); return end
        hx, hy = emu:read16(OE0 + 0x10), emu:read16(OE0 + 0x12)
        hx = hx + 2
        -- l'amico e' dell'ALTRO sesso: e' il caso che mette a rischio la palette
        genere = 1 - (emu:read8(emu:read32(0x03005D90) + 8) & 1)
        pal0 = palette0()
        dire(("giocatore a %d,%d; amico finto (sesso %d) a %d,%d"):format(hx - 2, hy, genere, hx, hy))
        stato, dalla = "STATO", 0
        return
    end

    controlla()

    if stato == "STATO" then
        -- si entra nello stato s+1: un VIA, poi SYNC ripetuti finche' il remoto c'e' con la grafica nuova
        if dalla == 1 then
            if s >= 0 then
                local n = 0; for _ in pairs(viste) do n = n + 1 end
                dire(("stato %d %-15s: eventi %4d, azioni applicate %4d, azioni DIVERSE eseguite %2d"):format(s, NOME[s], #lista * 2, applicati, n))
                if n == 0 and ANIM[s] >= 20 then falliti = falliti + 1; dire("  A4! nessuna azione eseguita: il banco non ha provato niente") end
            end
            s = s + 1
            if s > 7 then
                emu:screenshot(DIR .. "/fine.png")
                dire(("A1 animNum fuori tabella: %d | A2 azioni non lecite: %d | A3 palette del giocatore cambiata: %d"):format(errA1, errA2, errA3))
                fine((errA1 + errA2 + errA3 + falliti == 0) and "VERDETTO: OK" or "VERDETTO: FALLITO")
                return
            end
            viste, applicati = {}, 0
            lista = codici(not AZ_VELOCE and (s == 0 or s == 2 or s == 5 or s == 6))
            manda(4, 0, 0, hx, hy, genere, s)                          -- VIA: si riparte puliti
        elseif dalla % 12 == 6 and dalla < 120 then
            manda(2, 1, 0xFF, hx, hy, genere, s)                       -- SYNC nello stato nuovo
        elseif dalla >= 120 then
            if not remoto() then fine(("KO  stato %d: il remoto non compare"):format(s)); return end
            emu:screenshot(DIR .. ("/stato-%d.png"):format(s))
            i, modo, attesa = 1, 1, 0
            stato, dalla = "GIRO", 0
        end
        return
    end

    if stato == "GIRO" then
        if attesa > 0 then attesa = attesa - 1; return end
        local o = remoto()
        if not o then
            -- uscito di vista o distrutto: si rimette a casa e si prosegue
            manda(2, 1, 0xFF, hx, hy, genere, s); attesa = 30; return
        end
        if (emu:read8(o) & 0xC0) == 0x40 then return end              -- azione in corso: si aspetta
        local c = lista[i]
        if not c then
            if modo == 1 then modo, i = 2, 1; return end
            stato, dalla = "STATO", 0; return
        end
        local d = (i - 1) % 4                                           -- 0..3 = giu', su, sinistra, destra
        if lecita(c) and c ~= 0xFF and c >= 4 then d = c % 4; if c >= 0x15 and c <= 0x38 then d = (c - 0x15) % 4 end end
        local ax, ay = emu:read16(o + 0x10), emu:read16(o + 0x12)
        if modo == 1 then
            manda(3, d + 1, c, ax, ay, genere, s)                       -- GIRA
        elseif lecita(c) or c < 0xC0 then
            local dx = ({ 0, 0, -1, 1 })[d + 1]; local dy = ({ 1, -1, 0, 0 })[d + 1]
            manda(1, d + 1, c, ax + dx, ay + dy, genere, s)             -- PASSO di una casella
        end
        if c == 0xD0 or c == 0x7C or c == 0x0C then emu:screenshot(DIR .. ("/s%d-m%d-c%02X.png"):format(s, modo, c)) end
        i = i + 1
        attesa = 3
        -- ogni 16 eventi lo si riporta a casa: i passi del remoto non guardano i muri
        if i % 16 == 0 then manda(2, 1, 0xFF, hx, hy, genere, s) end
    end
end)
