@ exc_nvic: NVIC priorities and preemption (B1.5.4), PRIGROUP group/sub-
@ priority split, PRIMASK/BASEPRI/FAULTMASK masking, same-priority ordering
@ by exception number, tail-chaining, level-sensitive lines (re-pend while
@ asserted, ICPR cannot clear an asserted line), STIR, NMI, ICSR fields,
@ IABR, and late arrival during stacking. Log markers: 0x1nn = IRQ n entry,
@ 0x2nn = IRQ n exit, 0xAnnn = Thread-mode checkpoints.
  .include "common.inc"

  .text
  .thumb_func
  .global reset
reset:
  @ IRQ0..7 enabled; priorities IRQ0 0x80, IRQ1 0x40, IRQ2 0x40, IRQ3 0xC0, IRQ4 0x80, IRQ5 0x80, IRQ6 0x20, IRQ7 0x00
  STW ISER0, 0xff
  STW IPR0, 0xc0404080
  STW IPR0 + 4, 0x00208080
  @ ---- A: IRQ0 runs, pends IRQ1 (higher: preempts) and IRQ3 (lower: tail-chains)
  STW M_PEND, 0
  LOGI 0xa001
  @ ---- B: IRQ1 and IRQ2 (same priority) pended under PRIMASK: lower number first
  cpsid i
  STW M_PEND, 2
  STW M_PEND, 1
  LOGM ISPR0                @ both pending
  LOGM ICSR                 @ VECTPENDING = 17, ISRPENDING
  cpsie i
  LOGI 0xa002
  @ ---- C: PRIGROUP = 6 (group = bit 7): IRQ3 (0xC0) running, IRQ0 (0x80) same group → no preemption
  STW AIRCR, 0x05fa0600
  LOGM AIRCR
  STW M_DATA, 1             @ tells IRQ3 to pend IRQ0
  STW M_PEND, 3
  LOGI 0xa003
  @ ... and with PRIGROUP = 0 the same sequence nests
  STW AIRCR, 0x05fa0000
  STW M_DATA, 1
  STW M_PEND, 3
  LOGI 0xa004
  STW M_DATA, 0
  @ ---- D: BASEPRI = 0x80 masks IRQ0 (0x80) but not IRQ1 (0x40)
  movs r0, #0x80
  msr basepri, r0
  STW M_PEND, 0
  STW M_PEND, 1
  LOGI 0xa005
  movs r0, #0
  msr basepri, r0
  LOGI 0xa006
  @ ---- E: FAULTMASK masks even priority 0 (IRQ7); NMI is still taken
  cpsid f
  STW M_PEND, 7
  STW M_NMI, 1
  LOGI 0xa007
  cpsie f
  LOGI 0xa008
  @ ---- F: level-sensitive IRQ4: the handler leaves the line asserted once (re-pend), then drops it
  STW M_IRQ, 0x104
  LOGI 0xa009
  @ ---- G: ICPR cannot clear an asserted line; it can clear a pulse-pended one
  cpsid i
  STW M_IRQ, 0x105
  STW M_PEND, 6
  STW ICPR0, 0x60
  LOGM ISPR0                @ IRQ5 still pending, IRQ6 cleared
  STW M_DROP, 5             @ deassert: the pending state remains (it was latched)
  STW ICPR0, 0x20
  LOGM ISPR0                @ now IRQ5 clears
  cpsie i
  LOGI 0xa00a
  @ ---- H: STIR pends IRQ6 by number
  STW STIR, 6
  LOGI 0xa00b
  @ ---- I: late arrival: IRQ3 (0xC0) entry starts, IRQ6 (0x20) is asserted during its stacking
  STW M_TIRQ, 6
  STW M_TIMER, 12           @ IRQ6 line rises 12 cycles after this store ...
  STW M_PEND, 3             @ ... i.e. 4 cycles into the stacking of IRQ3 (pended at +6, entry at +8)
  LOGI 0xa00c
  STW M_DROP, 6
  bkpt #0

@ IRQ0: pend IRQ1 (preempts) and IRQ3 (tail-chains) on the first visit
  .thumb_func
IRQ0_Handler:
  LOGI 0x100
  LDC r12, M_DATA
  ldr r0, [r12]
  cmp r0, #0
  bne 1f
  LDC r0, 0
  LDC r12, M_LOG
  @ only in scenario A: the IRQ count at M_DATA+... is not needed, use a RAM flag
  ldr r1, =irq0_visits
  ldr r2, [r1]
  adds r2, #1
  str r2, [r1]
  cmp r2, #1
  bne 1f
  STW M_PEND, 1
  STW M_PEND, 3
  LOGM ICSR                 @ VECTACTIVE 16, VECTPENDING 19 (IRQ3), RETTOBASE 1
1:
  LOGI 0x200
  bx lr

  .thumb_func
IRQ1_Handler:
  LOGI 0x101
  LOGR lr                   @ 0xFFFFFFF1 when nested in IRQ0, 0xFFFFFFF9 from Thread
  LOGM ICSR                 @ RETTOBASE 0 while nested
  LOGM IABR0
  LOGI 0x201
  bx lr

  .thumb_func
IRQ2_Handler:
  LOGI 0x102
  LOGI 0x202
  bx lr

  .thumb_func
IRQ3_Handler:
  LOGI 0x103
  LDC r12, M_DATA
  ldr r0, [r12]
  cmp r0, #1
  bne 1f
  STW M_PEND, 0             @ IRQ0 (0x80) vs running IRQ3 (0xC0)
  LOGI 0x303
1:
  LOGI 0x203
  bx lr

  .thumb_func
IRQ4_Handler:
  LOGI 0x104
  ldr r1, =irq4_visits
  ldr r2, [r1]
  adds r2, #1
  str r2, [r1]
  cmp r2, #2
  blo 1f
  STW M_DROP, 4             @ second visit: release the line
1:
  LOGI 0x204
  bx lr

  .thumb_func
IRQ5_Handler:
  LOGI 0x105
  LOGI 0x205
  bx lr

  .thumb_func
IRQ6_Handler:
  LOGI 0x106
  LOGR lr                   @ 0xFFFFFFF9 when vectored by late arrival (no nesting)
  LOGM IABR0
  STW M_DROP, 6
  LOGI 0x206
  bx lr

  .thumb_func
IRQ7_Handler:
  LOGI 0x107
  LOGI 0x207
  bx lr

  .thumb_func
NMI_Handler:
  LOGI 0x1ff
  mrs r0, ipsr
  LOGR r0
  LOGI 0x2ff
  bx lr

  .ltorg
  UNEXPECTED
  VECTORS_AUTO

  .bss
  .align 2
irq0_visits: .space 4
irq4_visits: .space 4
