@ directed: corner cases the random differential vectors (tools/cpu-oracle)
@ cannot reach because they involve exceptions, the NVIC or the exclusive
@ monitor. Checked by tests/mcu/core/directed.test.ts; expected values are
@ derived there from the DDI 0403E rules cited next to each block.
@
@   A  an interrupt taken inside an IT block: ITSTATE stacked and restored
@   B  SVC inside an IT block (condition false: no SVC; true: IT resumes)
@   C  a faulting load inside an IT block is retried with its ITSTATE
@   E  LDREX/STREX: monitor cleared by exception entry and return, CLREX,
@      STREX; Cortex-M3 local monitor: no address tag, plain stores do not
@      clear it; exclusives on a device register; the ATOMIC_SET_BIT retry
@   F  LDM / LDMDB loading PC with the base register in the list
@   H  MOV PC, LR in a handler is a plain branch (no exception return)
@   I  POP {PC} and LDR PC exception returns; CONTROL writes in Handler mode
@   J  BASEPRI with 4 implemented priority bits, BASEPRI_MAX
@   K  BASEPRI compared by group priority (PRIGROUP)
@   L  no tail-chaining when the handler raises PRIMASK
@   M  tail-chaining into a priority between the returning and the resumed handler
@   N  ICSR for a pending but disabled interrupt
@   O  a fault with PRIMASK set is still taken (HardFault, priority -1)
@   D  BKPT inside an IT block whose condition fails still halts (last)
@ Log markers: 0x10n / 0x20n IRQ n entry / exit, 0x1b0 SVC, 0x1f3 HardFault,
@ 0xD0nn Thread-mode checkpoints.
  .include "common.inc"

  .text
  .thumb_func
  .global reset
reset:
  INIT_RAM
  @ IRQ0..7 enabled. IRQ0 0x80, IRQ1 0x80, IRQ2 0xF0, IRQ3 0x60, IRQ4 0x80, IRQ5 0x80, IRQ6 0x20, IRQ7 0xC0
  STW ISER0, 0xff
  STW IPR0, 0x60f08080
  STW IPR0 + 4, 0xc0208080

  @ ---- A: IRQ0 pended by the first slot of ITETE EQ
  movs r4, #0
  movs r5, #0
  movs r6, #0
  LDC r1, M_PEND
  movs r0, #0
  cmp r0, #0                @ Z = C = 1
  itete eq
  .global a_store
a_store:
  streq r0, [r1]            @ pends IRQ0, taken before the next slot
  .global a_next
a_next:
  addne r4, #1              @ skipped (NE)
  addeq r5, #2              @ executed (EQ, flags restored from the frame)
  addne r6, #3              @ skipped
  LOGR r4
  LOGR r5
  LOGR r6
  LOGI 0xd001

  @ ---- B: SVC in an IT block
  movs r4, #0
  movs r0, #1
  cmp r0, #0                @ Z = 0
  it eq
  svceq #1                  @ condition fails: no SVC
  cmp r0, #1                @ Z = C = 1
  ite eq
  svceq #2                  @ taken; returns into the ELSE slot
  .global b_next
b_next:
  addne r4, #1              @ must stay skipped after the return
  LOGR r4
  LOGI 0xd002

  @ ---- C: precise BusFault (escalated to HardFault) in an IT block, retried
  ldr r0, =scratch_ok
  ldr r2, =hf_fix_r1
  str r0, [r2]              @ the HardFault handler repoints the stacked r1 here
  LDC r1, 0x60000000        @ unmapped
  movs r0, #0
  movs r4, #0
  cmp r4, #0                @ Z = C = 1
  ite eq
  .global c_load
c_load:
  ldreq r0, [r1]
  addne r4, #1
  LOGR r0
  LOGR r4
  LOGI 0xd003

  @ ---- E: exclusive monitor
  ldr r1, =mon_word
  ldrex r0, [r1]            @ E1: plain LDREX/STREX succeeds
  adds r0, #1
  strex r2, r0, [r1]
  LOGR r2
  ldrex r0, [r1]            @ E2: an exception between them clears the monitor
  STW M_PEND, 1
  strex r2, r0, [r1]
  LOGR r2
  ldrex r0, [r1]            @ E3: a plain store to the same word does not (Cortex-M3)
  str r0, [r1]
  strex r2, r0, [r1]
  LOGR r2
  ldrex r0, [r1]            @ E4: no address tag: STREX to another word succeeds (Cortex-M3)
  LDC r0, 0x5a5a
  strex r2, r0, [r1, #4]
  LOGR r2
  ldr r0, [r1, #4]
  LOGR r0
  ldrex r0, [r1]            @ E5: CLREX closes it; so does a successful STREX
  clrex
  strex r2, r0, [r1]
  LOGR r2
  ldrex r0, [r1]
  strex r2, r0, [r1]
  strex r2, r0, [r1]
  LOGR r2
  svc #9                    @ E6: the handler opens the monitor; the exception return closes it
  strex r2, r0, [r1]
  LOGR r2
  LDC r1, M_DATA            @ E7: exclusives on a device register
  LDC r0, 0x10
  str r0, [r1]
  ldrex r0, [r1]
  orr r0, r0, #0x80
  strex r2, r0, [r1]
  LOGR r2
  LOGM M_DATA
  movs r5, #0               @ E8: ATOMIC_SET_BIT; an interrupt hits the first attempt
1:
  adds r5, #1
  ldrex r0, [r1]
  orr r0, r0, #0x100
  cmp r5, #1
  bne 2f
  STW M_PEND, 1
2:
  strex r2, r0, [r1]
  cmp r2, #0
  bne 1b
  LOGR r5
  LOGM M_DATA
  LOGI 0xd005

  @ ---- F: LDM/LDMDB {Rn, PC} without write-back (base loaded, then the branch)
  ldr r0, =ldm_tab
  ldm r0, {r0, pc}
  .global f_ret1
f_ret1:
  LOGR r0
  ldr r0, =ldm_tab2_end
  ldmdb r0, {r0, pc}
  .global f_ret2
f_ret2:
  LOGR r0
  LOGI 0xd006

  @ ---- H / I: handler-mode PC writes and CONTROL
  ldr r0, =svc3_resume + 1
  ldr r2, =hf_fix_pc
  str r0, [r2]
  svc #3                    @ MOV PC, LR → fetch from 0xFFFFFFF8 → IACCVIOL → HardFault
  svc #4                    @ PUSH {r4, LR} ... POP {r4, PC}
  svc #5                    @ STR LR, [SP, #-4]! ... LDR PC, [SP], #4
  movs r0, #0x80
  msr basepri, r0
  svc #6                    @ SPSEL write ignored in Handler mode; nPRIV = 1 for Thread
  mrs r0, control
  LOGR r0
  mrs r0, basepri           @ unprivileged: reads 0 although BASEPRI = 0x80
  LOGR r0
  movs r0, #0x20
  msr basepri, r0           @ ignored
  svc #7                    @ back to privileged
  mrs r0, control
  LOGR r0
  mrs r0, basepri
  LOGR r0
  movs r0, #0
  msr basepri, r0
  LOGI 0xd007

  @ ---- J: BASEPRI with 4 implemented bits
  movs r0, #0x0f
  msr basepri, r0
  mrs r0, basepri
  LOGR r0                   @ 0: unimplemented bits
  STW M_PEND, 2             @ BASEPRI 0 masks nothing: IRQ2 (0xF0) taken
  movs r0, #0x10
  msr basepri_max, r0       @ 0 → 0x10
  mrs r0, basepri
  LOGR r0
  STW M_PEND, 2             @ masked
  LOGM ICSR                 @ VECTPENDING 18
  movs r0, #0x30
  msr basepri_max, r0       @ lower priority: no change
  mrs r0, basepri
  LOGR r0
  movs r0, #0
  msr basepri, r0           @ IRQ2 taken here
  LOGI 0xd008

  @ ---- K: PRIGROUP 5 (group = bits [7:6]); BASEPRI 0x40 masks IRQ3 (0x60, group 0x40), not IRQ6 (0x20)
  STW AIRCR, 0x05fa0500
  movs r0, #0x40
  msr basepri, r0
  STW M_PEND, 3
  STW M_PEND, 6
  LOGM ICSR                 @ VECTPENDING 19
  movs r0, #0
  msr basepri, r0           @ IRQ3 taken
  STW AIRCR, 0x05fa0000
  LOGI 0xd009

  @ ---- L: IRQ5 raises PRIMASK and pends IRQ4: no tail-chain, IRQ4 after CPSIE
  STW M_PEND, 5
  LOGI 0xd00a
  mrs r0, primask
  LOGR r0
  cpsie i
  LOGI 0xd00b

  @ ---- M: IRQ7 (0xC0) → IRQ6 (0x20) nests and pends IRQ4 (0x80) → tail-chain into IRQ4
  ldr r0, =nest_mode
  movs r1, #1
  str r1, [r0]
  STW M_PEND, 7
  ldr r0, =nest_mode
  movs r1, #0
  str r1, [r0]
  LOGI 0xd00c

  @ ---- N: a pending IRQ that is not enabled: ISRPENDING without VECTPENDING
  cpsid i
  STW ISPR0, 0x100
  LOGM ICSR
  STW ICPR0, 0x100
  LOGM ICSR
  cpsie i
  LOGI 0xd00d

  @ ---- O: UDF with PRIMASK set → HardFault (FORCED) is still taken
  ldr r2, =hf_skip
  movs r0, #1
  str r0, [r2]
  cpsid i
  .global o_udf
o_udf:
  udf #7
  cpsie i
  LOGI 0xd00e

  @ ---- D: BKPT inside IT NE with Z = 1 executes anyway (the program ends here)
  movs r0, #0
  .global d_it
d_it:
  .hword 0xbf18             @ IT NE
  .global d_bkpt
d_bkpt:
  .hword 0xbe05             @ BKPT #5
  bkpt #0

@ ------------------------------------------------------------------ handlers

  .thumb_func
IRQ0_Handler:               @ A: report the stacked xPSR/PC, then clobber the flags
  LOGI 0x100
  ldr r0, [sp, #28]
  LOGR r0
  ldr r0, [sp, #24]
  LOGR r0
  movs r0, #1               @ Z = 0
  LOGI 0x200
  bx lr

  .thumb_func
IRQ1_Handler:
  LOGI 0x101
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
  LOGI 0x203
  bx lr

  .thumb_func
IRQ4_Handler:
  LOGI 0x104
  LOGR lr
  LOGM ICSR
  LOGI 0x204
  bx lr

  .thumb_func
IRQ5_Handler:               @ L
  LOGI 0x105
  cpsid i
  STW M_PEND, 4
  LOGI 0x205
  bx lr

  .thumb_func
IRQ6_Handler:
  LOGI 0x106
  LOGR lr
  ldr r0, =nest_mode
  ldr r0, [r0]
  cmp r0, #0
  beq 1f
  STW M_PEND, 4             @ M: lower than IRQ6, higher than the preempted IRQ7
1:
  LOGI 0x206
  bx lr

  .thumb_func
IRQ7_Handler:               @ M
  LOGI 0x107
  STW M_PEND, 6
  LOGI 0x207
  bx lr

  .thumb_func
SVC_Handler:
  LOGI 0x1b0
  ldr r0, [sp, #24]
  ldrb r2, [r0, #-2]        @ the SVC number
  LOGR r2
  cmp r2, #3
  bhs 3f
  ldr r0, [sp, #28]         @ 1, 2: stacked xPSR (IT state of the next slot), stacked PC
  LOGR r0
  ldr r0, [sp, #24]
  LOGR r0
  movs r0, #1               @ clobber Z
  bx lr
3:
  bne 4f
  mov pc, lr                @ BranchWritePC(0xFFFFFFF9): not an exception return
  .global svc3_resume
svc3_resume:                @ (the HardFault handler resumes here, still in SVCall)
  mrs r0, ipsr
  LOGR r0
  bx lr
4:
  cmp r2, #4
  bne 5f
  push {r4, lr}
  LOGI 0x4b4
  pop {r4, pc}              @ LoadWritePC(EXC_RETURN): exception return
5:
  cmp r2, #5
  bne 6f
  str lr, [sp, #-4]!
  LOGI 0x5b5
  ldr pc, [sp], #4
6:
  cmp r2, #6
  bne 7f
  movs r0, #2
  msr control, r0           @ SPSEL: ignored in Handler mode
  isb
  mrs r0, control
  LOGR r0
  movs r0, #1
  msr control, r0           @ nPRIV: takes effect for Thread mode
  isb
  mrs r0, control
  LOGR r0
  bx lr
7:
  cmp r2, #7
  bne 9f
  movs r0, #0
  msr control, r0
  isb
  bx lr
9:
  ldr r1, [sp, #4]          @ 9: open the monitor inside the handler
  ldrex r0, [r1]
  bx lr

  .thumb_func
HardFault_Handler:
  LOGI 0x1f3
  ldr r0, [sp, #24]
  LOGR r0                   @ stacked PC
  ldr r0, [sp, #28]
  LOGR r0                   @ stacked xPSR
  LOGM CFSR
  LOGM HFSR
  STW CFSR, 0xffffffff      @ write-one-to-clear
  STW HFSR, 0xffffffff
  ldr r2, =hf_fix_r1
  ldr r0, [r2]
  cbz r0, 1f
  str r0, [sp, #4]          @ stacked r1
  movs r0, #0
  str r0, [r2]
1:
  ldr r2, =hf_fix_pc
  ldr r0, [r2]
  cbz r0, 2f
  bic r0, r0, #1
  str r0, [sp, #24]         @ stacked PC
  movs r0, #0
  str r0, [r2]
2:
  ldr r2, =hf_skip
  ldr r0, [r2]
  cbz r0, 3f
  ldr r0, [sp, #24]
  adds r0, #2               @ skip the 16-bit UDF
  str r0, [sp, #24]
  movs r0, #0
  str r0, [r2]
3:
  bx lr

  .ltorg
  .p2align 2
ldm_tab:
  .word 0x11112222, f_ret1 + 1
ldm_tab2:
  .word 0x33334444, f_ret2 + 1
ldm_tab2_end:

  UNEXPECTED
  VECTORS_AUTO

  .data
  .align 2
scratch_ok: .word 0xc0de1234

  .bss
  .align 2
mon_word: .space 8
hf_fix_r1: .space 4
hf_fix_pc: .space 4
hf_skip: .space 4
nest_mode: .space 4
