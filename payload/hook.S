@ =============================================================================
@ hook.S — punto di ingresso del payload, agganciato al vettore IRQ 0x03007FFC
@ =============================================================================
@
@ Strategia (vedi CLAUDE.md, decisione architetturale n.3):
@ il vettore IRQ in IWRAM persiste ai cambi di scena, mentre gMain.vblankCallback
@ viene riscritto di continuo. Ci agganciamo lì e concateniamo all'handler originale.
@
@ Ordine scelto: **il nostro codice gira PRIMA**, poi si salta all'handler originale
@ con un tail jump. Così non dipendiamo dal fatto che l'handler del gioco preservi
@ il nostro lr — l'originale ritorna direttamente al BIOS.
@
@ Il BIOS salva r0-r3, r12 e lr prima di chiamare l'handler, quindi possiamo
@ sporcarli liberamente.
@
@ Layout dei primi 12 byte (l'iniettore ci scrive dentro):
@   +0x00  b hook_entry        <- il vettore IRQ punta qui
@   +0x04  g_origHandler       <- riempito dall'iniettore col vecchio vettore
@   +0x08  g_magic             <- 'HOOK', per verificare che il payload sia vivo

    .section .text.start, "ax"
    .arm
    .global _start
_start:
    b       hook_entry

    .global g_origHandler
g_origHandler:
    .word   0

    .global g_magic
g_magic:
    .word   0x4B4F4F48          @ "HOOK" in little endian

    .text
    .arm
    .global hook_entry
    .type   hook_entry, %function
hook_entry:
    stmfd   sp!, {lr}           @ lr del BIOS: ci serve intatto per il tail jump

    @ --- passaggio al nostro stack -------------------------------------------
    @ Lo stack IRQ del GBA è minuscolo (~0x60 byte a 0x03007FA0): non ci si può
    @ chiamare dentro codice C. Usiamo uno stack nostro dentro il payload.
    ldr     r0, =payload_stack_top
    mov     r1, sp              @ r1 = stack IRQ: lo salva hook_thumb sul NOSTRO
    mov     sp, r0

    @ --- il C gira dietro un trampolino Thumb (2026-10-08) -------------------
    @ main.c e sio.c si compilano con -mno-thumb-interwork: ogni funzione
    @ ritorna con `pop {pc}` invece di `pop {r0}; bx r0`, e sono ~165 byte di
    @ EWRAM. `pop {pc}` su ARM7TDMI NON cambia modo: va bene finche' chi chiama
    @ e' Thumb - e lo sono tutti i chiamanti del gioco (CallCallbacks,
    @ AnimateSprites, ScrCmd_callnative). L'UNICO chiamante ARM e' questo file:
    @ quindi qui si entra in Thumb una volta sola, con bx, e da Thumb si
    @ chiamano le due funzioni C con bl. Chi aggiunge una funzione C chiamata
    @ da codice ARM la fa passare di qui.
    ldr     r0, =hook_thumb
    mov     lr, pc
    bx      r0                  @ torna qui in ARM, con r1 = stack IRQ

    mov     sp, r1              @ ripristina lo stack IRQ
    ldmfd   sp!, {lr}           @ ripristina il lr del BIOS

    @ --- tail jump all'handler originale --------------------------------------
    ldr     r12, =g_origHandler
    ldr     r12, [r12]
    cmp     r12, #0
    bxne    r12                 @ l'originale ritornerà al BIOS con la lr giusta
    bx      lr                  @ nessun handler originale: torniamo noi
    .size   hook_entry, . - hook_entry
    .ltorg

    @ --- LA FALLA CHIUSA (2026-08-16) ----------------------------------------
    @ L'ordine delle due chiamate qui sotto e' una correzione, non un dettaglio.
    @
    @ Mentre payload_frame() gira, gli IRQ sono spenti a livello di CPU ma il
    @ bit 7 di REG_IF si ALZA lo stesso quando arriva uno scambio seriale - e
    @ ne arriva uno ogni ~4,4 ms, cioe' quasi certamente dentro un nostro giro
    @ di VBlank. Al tail jump, IntrMain legge `IF & IE`, ci trova il bit
    @ seriale, e chiama SerialIntr -> SerialCB del gioco: la macchina di link
    @ del gioco si SVEGLIA con dati che non sono suoi. Da li' CheckMasterOrSlave
    @ lo convince di essere master, InitTimer arma il Timer 3 (nel log: IE passa
    @ da 0x0085 a 0x00C5 e non torna piu' indietro), StartTransfer comincia a
    @ riscrivergli SIOCNT addosso a ogni frame - le nostre RIPARAZIONI - e il
    @ gioco si mette ad aspettare un partner che non parla la sua lingua.
    @
    @ La cura e' raccogliere cio' che e' caduto nella nostra finestra PRIMA di
    @ passare la mano: payload_drain() gestisce e riconosce l'IRQ seriale
    @ rimasto in sospeso, cosi' IntrMain non lo vede piu'. Se la porta non e'
    @ nostra (Cable Club) payload_drain() non tocca niente e l'IRQ va al
    @ gioco, che e' esattamente cio' che deve succedere li'.
    @
    @ Sul nostro stack vanno 8 byte: lo stack IRQ (r1) e il ritorno in ARM. E'
    @ lo stesso numero di prima (HOOK_S_PUSH in build.ps1).
    .thumb
    .thumb_func
    .type   hook_thumb, %function
hook_thumb:
    push    {r1, lr}
    bl      payload_frame
    bl      payload_drain
    pop     {r1, r3}
    bx      r3
    .size   hook_thumb, . - hook_thumb
