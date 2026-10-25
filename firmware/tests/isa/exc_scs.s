@ exc_scs: System Control Space registers (B3.2-B3.4, C1.7/C1.8):
@ identification, SysTick interrupt periods with the core clock and with the
@ external reference clock (HCLK/8 on STM32), LOAD = 0, COUNTFLAG semantics,
@ DWT.CYCCNT, ITM stimulus ports, VTOR relocation to SRAM, byte/halfword
@ access to SHPR/IPR, ICSR PENDSTSET/PENDSTCLR, AIRCR key and SYSRESETREQ,
@ an unimplemented PPB register and peripheral bit-banding.
  .include "common.inc"

  .text
  .thumb_func
  .global reset
reset:
  INIT_RAM
  @ ---- identification (slots: CPUID, ICTR, CALIB, AIRCR, CCR, LOAD masked to 24 bits)
  LOGM CPUID
  LOGM ICTR
  LOGM STCALIB
  LOGM AIRCR
  LOGM CCR
  STW STRVR, 0x12345678
  LOGM STRVR
  @ ---- SysTick on the core clock: LOAD 999 → an interrupt every 1000 cycles
  LOGI 0x5101
  STW STRVR, 999
  STW STCVR, 0
  STW STCSR, 7
1:
  ldr r0, =ticks
  ldr r0, [r0]
  cmp r0, #5
  blo 1b
  STW STCSR, 0
  @ ---- reference clock (CLKSOURCE = 0, HCLK/8): LOAD 99 → every 800 cycles
  LOGI 0x5102
  STW STRVR, 99
  STW STCVR, 0
  STW STCSR, 3
1:
  ldr r0, =ticks
  ldr r0, [r0]
  cmp r0, #9
  blo 1b
  STW STCSR, 0
  @ ---- LOAD = 0 never counts down to a 1→0 transition: no interrupt, no COUNTFLAG
  LOGI 0x5103
  STW STRVR, 0
  STW STCVR, 0
  STW STCSR, 7
  movs r0, #200
1:
  subs r0, #1
  bne 1b
  LOGM STCSR                   @ 0x00000007: COUNTFLAG clear
  STW STCSR, 0
  @ ---- COUNTFLAG without TICKINT: set by the wrap, cleared by the read and by a VAL write
  STW STRVR, 99
  STW STCVR, 0
  STW STCSR, 5
  movs r0, #100
1:
  subs r0, #1
  bne 1b
  LOGM STCSR                   @ 0x00010005
  LOGM STCSR                   @ 0x00000005 (cleared by the previous read)
  movs r0, #100
1:
  subs r0, #1
  bne 1b
  STW STCVR, 0                 @ clears COUNTFLAG
  LOGM STCSR                   @ 0x00000005
  STW STCSR, 0
  @ ---- ICSR PENDSTSET pends SysTick (taken), PENDSTCLR clears it (under PRIMASK)
  LOGI 0x5104
  STW ICSR, (1 << 26)
  cpsid i
  STW ICSR, (1 << 26)
  LOGM ICSR                    @ PENDSTSET, VECTPENDING 15
  STW ICSR, (1 << 25)
  LOGM ICSR
  cpsie i
  @ ---- DWT.CYCCNT
  LOGI 0x5105
  STW DEMCR, (1 << 24)
  STW DWT_CYCCNT, 0
  STW DWT_CTRL, 1
  LDC r12, DWT_CYCCNT
  ldr r0, [r12]
  nop
  nop
  nop
  nop
  nop
  nop
  nop
  nop
  nop
  nop
  ldr r1, [r12]
  sub r2, r1, r0
  LOGR r2                      @ 2 (LDR) + 10 (NOP) cycles
  STW DWT_CTRL, 0
  LDC r12, DWT_CYCCNT
  ldr r0, [r12]
  nop
  nop
  ldr r1, [r12]
  sub r2, r1, r0
  LOGR r2                      @ stopped: 0
  @ ---- ITM: unlock, enable, port 0 only
  LOGI 0x5106
  STW ITM_TCR, 1               @ ignored: still locked
  STW ITM_LAR, 0xc5acce55
  STW ITM_TCR, 1
  STW ITM_TER, 1
  LDC r2, ITM_STIM0
  ldr r0, [r2]
  LOGR r0                      @ FIFOREADY = 1
  movs r0, #'O'
  strb r0, [r2]
  movs r0, #'K'
  strb r0, [r2]
  LDC r0, 0x12345678
  str r0, [r2, #4]            @ port 1 disabled
  str r0, [r2]                @ 32-bit write to port 0
  STW DEMCR, 0
  movs r0, #'X'
  strb r0, [r2]               @ TRCENA = 0: ITM off
  @ ---- VTOR relocation: a copy of the table in SRAM with another SysTick vector
  LOGI 0x5107
  LDC r0, 0x08000000
  LDC r1, ram_vectors
  movs r2, #32
1:
  ldr r3, [r0], #4
  str r3, [r1], #4
  subs r2, #1
  bne 1b
  LDC r1, ram_vectors
  LDC r0, SysTick_Alt
  str r0, [r1, #15 * 4]
  LDC r12, VTOR
  str r1, [r12]
  LOGM VTOR
  STW ICSR, (1 << 26)
  STW VTOR, 0x08000000
  @ ---- byte / halfword accesses to the priority registers (4 bits implemented)
  LOGI 0x5108
  LDC r2, SHPR3
  movs r0, #0xff
  strb r0, [r2, #3]           @ SysTick priority
  movs r0, #0x5a
  strb r0, [r2, #2]           @ PendSV priority
  ldr r0, [r2]
  LOGR r0                      @ 0xf0500000
  ldrb r0, [r2, #3]
  LOGR r0
  LDC r2, IPR0
  LDC r0, 0xa1b2
  strh r0, [r2, #2]
  ldr r0, [r2]
  LOGR r0                      @ 0xa0b00000
  ldrh r0, [r2, #2]
  LOGR r0
  @ ---- AIRCR: writes without VECTKEY are ignored; SYSRESETREQ calls the SoC hook
  LOGI 0x5109
  STW AIRCR, 0x00000500
  LOGM AIRCR
  STW AIRCR, 0x05fa0304        @ PRIGROUP 3 + SYSRESETREQ
  LOGM AIRCR
  @ ---- unimplemented PPB register (FPB_CTRL) reads as zero
  LOGM 0xe0002000
  @ ---- peripheral bit-band alias: M_DATA bit 3 (0x42000000 + 0 * 32 + 3 * 4)
  LOGI 0x510a
  STW M_DATA, 0x100
  STW 0x4200000c, 1
  LOGM M_DATA                  @ 0x108
  STW 0x42000020, 0            @ bit 8 cleared
  LOGM M_DATA                  @ 0x008
  LOGM 0x4200000c              @ 1
  LOGM 0x42000010              @ 0
  bkpt #0

  .thumb_func
SysTick_Handler:
  LDC r12, M_CYC
  ldr r0, [r12]
  LOGR r0
  ldr r0, =ticks
  ldr r1, [r0]
  adds r1, #1
  str r1, [r0]
  bx lr

  .thumb_func
SysTick_Alt:
  LOGI 0xa17
  bx lr

  .ltorg
  UNEXPECTED
  VECTORS_AUTO

  .bss
  .align 7
ram_vectors: .space 128
ticks: .space 4
