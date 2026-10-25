@ exc_sleep: WFI/WFE (B1.5.17-B1.5.19): WFI sleeps until an interrupt that
@ could preempt if PRIMASK were 0 (taken at once, or deferred with PRIMASK
@ set), SEV + WFE returns immediately, WFE with SCR.SEVONPEND wakes on a
@ disabled interrupt becoming pending, SCR.SLEEPONEXIT returns to sleep after
@ the handler. The scratch device's timer asserts IRQ0/IRQ1 lines.
  .include "common.inc"

  .text
  .thumb_func
  .global reset
reset:
  INIT_RAM
  STW ISER0, 1                 @ IRQ0 enabled, IRQ1 disabled
  STW M_TIRQ, 0
  @ ---- 1: WFI until the timer fires 100000 cycles later
  LDC r12, M_CYC
  ldr r4, [r12]
  STW M_TIMER, 100000
  .global wfi1
wfi1:
  wfi
  LDC r12, M_CYC
  ldr r5, [r12]
  LOGR r4
  LOGR r5
  @ ---- 2: WFI with PRIMASK = 1 wakes up but the IRQ waits for CPSIE
  cpsid i
  STW M_TIMER, 5000
  wfi
  LOGI 0x2001
  cpsie i
  LOGI 0x2002
  @ ---- 3: SEV then WFE: no sleep; SEVONPEND: a disabled IRQ becoming pending wakes WFE
  sev
  wfe
  LOGI 0x3001
  STW SCR, 0x10
  STW M_TIRQ, 1
  STW M_TIMER, 3000
  wfe
  LOGM ISPR0
  STW M_DROP, 1
  STW ICPR0, 2
  STW SCR, 0
  STW M_TIRQ, 0
  @ ---- 4: SLEEPONEXIT: the handler re-arms the timer once; the core sleeps between the two IRQs
  STW SCR, 0x2
  STW M_TIMER, 2000
  wfi
  LOGI 0x4001
  bkpt #0

  .thumb_func
IRQ0_Handler:
  LDC r12, M_CYC
  ldr r0, [r12]
  LOGR r0
  STW M_DROP, 0
  ldr r1, =visits
  ldr r2, [r1]
  adds r2, #1
  str r2, [r1]
  LDC r12, SCR
  ldr r0, [r12]
  tst r0, #2
  beq 2f
  cmp r2, #3                    @ visits 1-2: scenarios 1 and 2; 3 = first SLEEPONEXIT IRQ
  bne 1f
  STW M_TIMER, 2000
  b 2f
1:
  STW SCR, 0                    @ second SLEEPONEXIT IRQ: stop sleeping on exit
2:
  LOGI 0x100
  bx lr

  .ltorg
  UNEXPECTED
  VECTORS_AUTO

  .bss
  .align 2
visits: .space 4
