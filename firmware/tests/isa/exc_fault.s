@ exc_fault: synchronous faults (B1.5.14-B1.5.16, B3.2.15/16):
@ UNDEFINSTR (UDF, DSP-only encodings), NOCP (FP/coprocessor space),
@ DIVBYZERO (CCR.DIV_0_TRP), INVSTATE (BX to an even address), UNALIGNED
@ (CCR.UNALIGN_TRP and the always-aligned LDM/LDRD/LDREX), precise BusFault
@ with BFAR, MemManage IACCVIOL on execute-never memory, unprivileged SCS
@ access, escalation to HardFault (fault disabled / not higher priority than
@ the running SVC) and a vector-table read error (HFSR.VECTTBL).
@ Every fault handler logs: 0xFA17, IPSR, CFSR, HFSR, [BFAR if BFARVALID],
@ stacked PC; then clears CFSR/HFSR and resumes according to `fixup`.
  .include "common.inc"

.macro FIX n
  ldr r0, =fixup
  movs r1, #\n
  str r1, [r0]
.endm

  .text
  .thumb_func
  .global reset
reset:
  LDC r0, 0x20004000        @ keep the stack away from the SRAM vector-table copy (test 12)
  msr msp, r0
  FIX 0
  @ ---- 1: UDF with UsageFault disabled → HardFault (FORCED)
  LOGI 0xf001
  .global udf1
udf1:
  udf #7
  @ ---- 2: enable UsageFault: UDF.W → UsageFault
  STW SHCSR, (1 << 18)
  LOGI 0xf002
  .global udf2
udf2:
  udf.w #9
  @ ---- 3: SDIV by zero: no trap by default, DIVBYZERO with CCR.DIV_0_TRP
  movs r1, #7
  movs r2, #0
  sdiv r0, r1, r2
  LOGR r0
  STW CCR, 0x10
  LOGI 0xf003
  .global div1
div1:
  udiv r0, r1, r2
  STW CCR, 0
  @ ---- 4: BX to an even address → INVSTATE at the target; the handler sets T and resumes there
  FIX 2
  LOGI 0xf004
  LDC r0, inv_target
  bic r0, r0, #1
  bx r0
  .thumb_func
  .global inv_target
inv_target:
  LOGI 0xf104
  FIX 0
  @ ---- 5: unaligned accesses
  LDC r1, buf + 1
  STW CCR, (1 << 3)          @ UNALIGN_TRP
  LOGI 0xf005
  .global una1
una1:
  ldr r0, [r1]
  .global una2
una2:
  ldrh.w r0, [r1, #2]
  STW CCR, 0
  ldr r0, [r1]               @ allowed: performed as byte accesses
  LOGR r0
  .global una3
una3:
  ldm r1, {r2, r3}            @ LDM is always aligned
  LDC r1, buf + 2
  .global una4
una4:
  ldrd r2, r3, [r1]
  .global una5
una5:
  ldrex r2, [r1]
  @ ---- 6: coprocessor / FP encodings → NOCP; DSP-only encodings → UNDEFINSTR
  LOGI 0xf006
  .global nocp1
nocp1:
  .inst.w 0xee000a10          @ VMOV s0, r0 (FPv4)
  .global nocp2
nocp2:
  .inst.w 0xee110f10          @ MRC p15
  .global dsp1
dsp1:
  .inst.w 0xfa82f081          @ QADD
  .global dsp2
dsp2:
  .inst.w 0xfbe20163          @ UMAAL
  .global dsp3
dsp3:
  .inst.w 0xfa41f082          @ SXTAB
  .global dsp4
dsp4:
  .inst.w 0xeac10002          @ PKHBT
  @ ---- 7: BusFault on an unmapped address: disabled → HardFault, enabled → BusFault, BFAR valid
  LOGI 0xf007
  LDC r1, 0x30000000
  .global bus1
bus1:
  ldr r0, [r1]
  STW SHCSR, (1 << 18) | (1 << 17)
  LDC r1, 0x30000004
  .global bus2
bus2:
  str r0, [r1]
  @ ---- 8: execute-never peripheral space → MemManage IACCVIOL (disabled → HardFault, then enabled)
  FIX 1
  LOGI 0xf008
  LDC r0, 0x40000101
  blx r0
  STW SHCSR, (1 << 18) | (1 << 17) | (1 << 16)
  LDC r0, 0xe0000201
  blx r0
  FIX 0
  @ ---- 9: unprivileged access to the SCS → BusFault (the handler restores privilege)
  LOGI 0xf009
  movs r0, #1
  msr control, r0
  isb
  LDC r1, CPUID
  .global unpriv1
unpriv1:
  ldr r0, [r1]
  mrs r0, control
  LOGR r0
  @ ---- 10: a UsageFault inside SVC (both priority 0) cannot preempt → HardFault
  LOGI 0xf00a
  svc #0
  LOGI 0xf10a
  @ ---- 11: vector-table read error: VTOR in SRAM, IRQ20's vector beyond the end of SRAM
  LOGI 0xf00b
  FIX 3
  LDC r0, 0x08000000
  LDC r1, 0x20004f80
  movs r2, #16
1:
  ldr r3, [r0], #4
  str r3, [r1], #4
  subs r2, #1
  bne 1b
  STW VTOR, 0x20004f80
  STW ISER0 + 0, (1 << 20)
  STW ISPR0 + 0, (1 << 20)
  .global after_ispr
after_ispr:
  LOGI 0xf10b
  LOGM VTOR
  bkpt #0

  .thumb_func
SVC_Handler:
  .global udf_svc
udf_svc:
  udf #1
  bx lr

  .thumb_func
HardFault_Handler:
  b fault_common
  .thumb_func
MemManage_Handler:
  b fault_common
  .thumb_func
BusFault_Handler:
  b fault_common
  .thumb_func
UsageFault_Handler:
  b fault_common

fault_common:
  LOGI 0xfa17
  mrs r0, ipsr
  LOGR r0
  LOGM CFSR
  LOGM HFSR
  LDC r12, CFSR
  ldr r0, [r12]
  tst r0, #0x8000
  beq 1f
  LOGM BFAR
1:
  tst lr, #4
  ite eq
  mrseq r1, msp
  mrsne r1, psp
  ldr r2, [r1, #24]
  LOGR r2
  @ clear the fault status (write-one-to-clear)
  LDC r12, CFSR
  ldr r0, [r12]
  str r0, [r12]
  LDC r12, HFSR
  ldr r0, [r12]
  str r0, [r12]
  @ handler mode may always write CONTROL.nPRIV: back to privileged Thread mode
  mrs r0, control
  bic r0, r0, #1
  msr control, r0
  ldr r0, =fixup
  ldr r0, [r0]
  cmp r0, #1
  beq 2f
  cmp r0, #2
  beq 3f
  cmp r0, #3
  beq 4f
  @ skip the faulting instruction (32-bit when the first halfword is >= 0xE800)
  ldrh r3, [r2]
  cmp r3, #0xe800
  ite hs
  addhs r2, #4
  addlo r2, #2
  str r2, [r1, #24]
  bx lr
2:
  @ a call into execute-never memory: resume at the caller's return address
  ldr r2, [r1, #20]
  bic r2, r2, #1
  str r2, [r1, #24]
  bx lr
3:
  @ INVSTATE: set EPSR.T in the stacked xPSR and retry
  ldr r2, [r1, #28]
  orr r2, r2, #0x01000000
  str r2, [r1, #28]
  bx lr
4:
  @ vector-table error: restore VTOR and disable the offending interrupt
  STW VTOR, 0x08000000
  STW ICER0, (1 << 20)
  STW ICPR0, (1 << 20)
  bx lr

  .ltorg
  UNEXPECTED
  VECTORS_AUTO

  .bss
  .align 3
fixup: .space 4
  .space 4
buf: .space 16
