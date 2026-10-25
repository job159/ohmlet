@ Common definitions for the Cortex-M3 instruction-set test programs.
@ Assembled by firmware/tests/isa/build.mjs (clang integrated assembler,
@ --target=thumbv7m-none-eabi -mcpu=cortex-m3). Every program ends with
@ `bkpt #0` (the core halts on BKPT); `bkpt #0xEE` marks an unexpected
@ exception.

  .syntax unified
  .thumb

@ load a 32-bit constant without a literal pool and without touching flags
.macro LDC reg, value
  movw \reg, #:lower16:(\value)
  movt \reg, #:upper16:(\value)
.endm

@ CASE "insn", r0, r1, r2, r3 [, apsr]
@ Loads r0..r3 and APSR.NZCVQ, executes `insn` (which may be an IT block such
@ as "it eq; addeq r0, r1, r2"), appends {r0, r1, APSR} to the result table at
@ r8 and the descriptor {text, r0, r1, r2, r3, apsr} to section .cases, so
@ the test can recompute every expectation from the ARM ARM semantics.
.macro CASE insn, w, x, y, z, f=0
  LDC r0, \w
  LDC r1, \x
  LDC r2, \y
  LDC r3, \z
  LDC r4, \f
  msr APSR_nzcvq, r4
  \insn
  mrs r4, APSR
  stmia r8!, {r0, r1, r4}
  .pushsection .cases, "a"
  .word .Lcs\@, \w, \x, \y, \z, \f
  .popsection
  .pushsection .casestr, "a"
.Lcs\@: .asciz "\insn"
  .popsection
.endm

@ append register \reg to the result table at r8 (flags preserved)
.macro REC reg
  str \reg, [r8], #4
.endm

@ copy .data from flash, zero .bss (clobbers r0-r3)
.macro INIT_RAM
  ldr r0, =_sidata
  ldr r1, =_sdata
  ldr r2, =_edata
1:
  cmp r1, r2
  bhs 2f
  ldr r3, [r0], #4
  str r3, [r1], #4
  b 1b
2:
  ldr r1, =_sbss
  ldr r2, =_ebss
  movs r3, #0
3:
  cmp r1, r2
  bhs 4f
  str r3, [r1], #4
  b 3b
4:
.endm

@ minimal vector table: SP, reset, and every other slot → `unexpected`
.macro VECTORS_MIN
  .section .isr_vector, "a"
  .word _estack
  .word reset
  .rept 14
  .word unexpected
  .endr
  .text
.endm

@ the unexpected-exception trap
.macro UNEXPECTED
  .thumb_func
unexpected:
  bkpt #0xee
  b unexpected
.endm

@ The standard operand vectors: (r0, r1, r2, r3, APSR) chosen to hit every
@ flag outcome — zero, sign changes, signed/unsigned overflow, carry in/out,
@ shift amounts 0/1/31/32/33/255/256 in r2[7:0] and NZCVQ preset patterns.
.macro VEC12 insn
  CASE "\insn", 0, 0, 0, 0, 0
  CASE "\insn", 0xa5a5a5a5, 1, 1, 0, 0x20000000
  CASE "\insn", 0, 0x7fffffff, 1, 0, 0
  CASE "\insn", 0, 0x80000000, 0xffffffff, 0, 0x20000000
  CASE "\insn", 0, 0xffffffff, 0xffffffff, 0, 0xf8000000
  CASE "\insn", 0, 0x12345678, 0x9abcdef0, 0, 0x20000000
  CASE "\insn", 0x11111111, 0xdeadbeef, 0x0000001f, 0x55, 0
  CASE "\insn", 0, 0x80000000, 0x80000000, 0, 0x30000000
  CASE "\insn", 0, 0x00000001, 0x00000020, 0, 0
  CASE "\insn", 0, 0x80000001, 0x00000021, 0, 0x20000000
  CASE "\insn", 0, 0xfffffffe, 0x000000ff, 0, 0
  CASE "\insn", 0, 0x40000000, 0x00000100, 0, 0x20000000
.endm

@ a smaller set for the large shifted-register matrix
.macro VEC6 insn
  CASE "\insn", 0, 0, 0, 0, 0
  CASE "\insn", 0, 0x7fffffff, 1, 0, 0x20000000
  CASE "\insn", 0, 0x80000000, 0xffffffff, 0, 0x20000000
  CASE "\insn", 0, 0xffffffff, 0xffffffff, 0, 0xf8000000
  CASE "\insn", 0, 0x12345678, 0x9abcdef0, 0, 0
  CASE "\insn", 0, 0x80000001, 0x80000003, 0, 0x30000000
.endm

@ operand vectors for multiplies (r2 x r3, accumulate r0/r1 or r3)
.macro VECMUL insn
  CASE "\insn", 0, 0, 0, 0, 0
  CASE "\insn", 0x11111111, 0x22222222, 0xffffffff, 0xffffffff, 0x20000000
  CASE "\insn", 0xffffffff, 0xffffffff, 0x7fffffff, 0x7fffffff, 0
  CASE "\insn", 1, 2, 0x80000000, 0x80000000, 0xf8000000
  CASE "\insn", 0x80000000, 0x7fffffff, 0x12345678, 0x9abcdef0, 0
  CASE "\insn", 0xdeadbeef, 0xcafebabe, 0xffff0000, 0x0000ffff, 0x40000000
  CASE "\insn", 5, 7, 0x00010001, 0xfffffffe, 0
  CASE "\insn", 0, 0, 3, 0x80000001, 0x10000000
.endm

@ operand vectors for divides (r1 / r2)
.macro VECDIV insn
  CASE "\insn", 0, 7, 0, 0, 0
  CASE "\insn", 0, 0x80000000, 0xffffffff, 0, 0
  CASE "\insn", 0, 100, 7, 0, 0
  CASE "\insn", 0, 0xffffff9c, 7, 0, 0x20000000
  CASE "\insn", 0, 100, 0xfffffff9, 0, 0
  CASE "\insn", 0, 0xffffffff, 1, 0, 0
  CASE "\insn", 0, 0xffffffff, 0xffffffff, 0, 0
  CASE "\insn", 0, 0x7fffffff, 2, 0, 0
  CASE "\insn", 0, 5, 10, 0, 0
  CASE "\insn", 0, 0x80000000, 2, 0, 0
  CASE "\insn", 0, 0xfffffff9, 0xfffffffe, 0, 0
  CASE "\insn", 0, 0xffffffff, 0x10000, 0, 0
.endm

@ operand vectors for saturation (r1), with Q clear and preset
.macro VECSAT insn
  CASE "\insn", 0, 0, 0, 0, 0
  CASE "\insn", 0, 1, 0, 0, 0
  CASE "\insn", 0, 0xffffffff, 0, 0, 0
  CASE "\insn", 0, 127, 0, 0, 0
  CASE "\insn", 0, 128, 0, 0, 0
  CASE "\insn", 0, 0xffffff80, 0, 0, 0
  CASE "\insn", 0, 0xffffff7f, 0, 0, 0
  CASE "\insn", 0, 0x7fffffff, 0, 0, 0
  CASE "\insn", 0, 0x80000000, 0, 0, 0
  CASE "\insn", 0, 0x12345678, 0, 0, 0x08000000
  CASE "\insn", 0, 0xfff00000, 0, 0, 0
  CASE "\insn", 0, 255, 0, 0, 0
  CASE "\insn", 0, 256, 0, 0, 0xf8000000
.endm

@ the ten Rd/Rn/Rm data-processing ops with every shift kind
.macro DP10 op
  VEC6 "\op\().w r0, r1, r2"
  VEC6 "\op\()s.w r0, r1, r2"
  VEC6 "\op\()s.w r0, r1, r2, lsl #4"
  VEC6 "\op\().w r0, r1, r2, lsl #31"
  VEC6 "\op\()s.w r0, r1, r2, lsr #1"
  VEC6 "\op\()s.w r0, r1, r2, lsr #32"
  VEC6 "\op\()s.w r0, r1, r2, asr #5"
  VEC6 "\op\()s.w r0, r1, r2, asr #32"
  VEC6 "\op\()s.w r0, r1, r2, ror #8"
  VEC6 "\op\()s.w r0, r1, r2, rrx"
.endm

@ modified-immediate forms of an Rd, Rn, #imm op (plain, replicated and rotated constants)
.macro DPI op, w=.w
  VEC6 "\op\()s\w r0, r1, #0"
  VEC6 "\op\()s\w r0, r1, #0xff"
  VEC6 "\op\()s\w r0, r1, #0x00ab00ab"
  VEC6 "\op\()s\w r0, r1, #0xab00ab00"
  VEC6 "\op\()s\w r0, r1, #0xabababab"
  VEC6 "\op\()s\w r0, r1, #0x80000000"
  VEC6 "\op\()s\w r0, r1, #0x3fc"
  VEC6 "\op\()s\w r0, r1, #0xff000000"
  VEC6 "\op\w r0, r1, #0x7f800000"
.endm

@ ------------------------------------------------------------------------
@ Exception-test support: the harness scratch MMIO device (tests/mcu/core/
@ harness.ts) and the System Control Space registers (ARMv7-M ARM B3.2-B3.4).
.equ M_DATA,   0x40000000
.equ M_LOG,    0x40000004   @ every write is appended to the test's log
.equ M_IRQ,    0x40000008   @ write (level << 8 | irq): drive an IRQ line
.equ M_PEND,   0x4000000C   @ write irq: pulse-pend an IRQ
.equ M_TIMER,  0x40000010   @ write N: assert line M_TIRQ after N cycles
.equ M_TIRQ,   0x40000014
.equ M_CYC,    0x40000018   @ read: clock.cycles at the start of the load
.equ M_SYNC,   0x4000001C
.equ M_NMI,    0x40000020   @ write: pend NMI
.equ M_EVT,    0x40000024   @ write: external event (wakes WFE)
.equ M_DROP,   0x40000028   @ write irq: deassert an IRQ line

.equ ICTR,     0xE000E004
.equ STCSR,    0xE000E010
.equ STRVR,    0xE000E014
.equ STCVR,    0xE000E018
.equ STCALIB,  0xE000E01C
.equ ISER0,    0xE000E100
.equ ICER0,    0xE000E180
.equ ISPR0,    0xE000E200
.equ ICPR0,    0xE000E280
.equ IABR0,    0xE000E300
.equ IPR0,     0xE000E400
.equ CPUID,    0xE000ED00
.equ ICSR,     0xE000ED04
.equ VTOR,     0xE000ED08
.equ AIRCR,    0xE000ED0C
.equ SCR,      0xE000ED10
.equ CCR,      0xE000ED14
.equ SHPR1,    0xE000ED18
.equ SHPR2,    0xE000ED1C
.equ SHPR3,    0xE000ED20
.equ SHCSR,    0xE000ED24
.equ CFSR,     0xE000ED28
.equ HFSR,     0xE000ED2C
.equ MMFAR,    0xE000ED34
.equ BFAR,     0xE000ED38
.equ STIR,     0xE000EF00
.equ DEMCR,    0xE000EDFC
.equ DWT_CTRL, 0xE0001000
.equ DWT_CYCCNT, 0xE0001004
.equ ITM_STIM0, 0xE0000000
.equ ITM_TER,  0xE0000E00
.equ ITM_TCR,  0xE0000E80
.equ ITM_LAR,  0xE0000FB0

@ log an immediate (clobbers r3, r12)
.macro LOGI val
  LDC r12, M_LOG
  LDC r3, \val
  str r3, [r12]
.endm
@ log a register (clobbers r12; \reg must not be r12)
.macro LOGR reg
  LDC r12, M_LOG
  str \reg, [r12]
.endm
@ log the word at an address (clobbers r3, r12)
.macro LOGM addr
  LDC r12, \addr
  ldr r3, [r12]
  LDC r12, M_LOG
  str r3, [r12]
.endm
@ store a constant word to an address (clobbers r3, r12)
.macro STW addr, val
  LDC r12, \addr
  LDC r3, \val
  str r3, [r12]
.endm

@ vector table built at the END of a program: a slot points at its handler
@ when the program defines one (NMI_Handler, ..., IRQ<n>_Handler), else at
@ `unexpected`
.macro VSLOT name
  .ifdef \name
  .word \name
  .else
  .word unexpected
  .endif
.endm
.macro VECTORS_AUTO
  .section .isr_vector, "a"
  .word _estack
  .word reset
  VSLOT NMI_Handler
  VSLOT HardFault_Handler
  VSLOT MemManage_Handler
  VSLOT BusFault_Handler
  VSLOT UsageFault_Handler
  .word unexpected, unexpected, unexpected, unexpected
  VSLOT SVC_Handler
  VSLOT DebugMon_Handler
  .word unexpected
  VSLOT PendSV_Handler
  VSLOT SysTick_Handler
  VSLOT IRQ0_Handler
  VSLOT IRQ1_Handler
  VSLOT IRQ2_Handler
  VSLOT IRQ3_Handler
  VSLOT IRQ4_Handler
  VSLOT IRQ5_Handler
  VSLOT IRQ6_Handler
  VSLOT IRQ7_Handler
  .rept 35
  .word unexpected
  .endr
  .text
.endm
