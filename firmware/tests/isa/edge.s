@ edge: corner cases compilers never emit but the architecture defines:
@  1. every write to SP clears SP[1:0] (B1.4.1, pseudocode SP_main/SP_process =
@     value<31:2>:'00'; Cortex-M3 TRM: SP bits [1:0] are RAZ/WI): MOV.W SP, Rm,
@     ADD.W SP, SP, Rm, SUB.W SP, SP, Rm, LSL #1, LDR.W SP (immediate and
@     register offset), and a post-indexed load whose SP base advances by 3;
@  2. UNPREDICTABLE encodings executed the way the ARM ARM pseudocode does (and
@     logged once by the core): STRD with Rn = PC (A7.7.163: n == 15 is
@     UNPREDICTABLE, not UNDEFINED; R[15] reads as the instruction address + 4),
@     run from SRAM so the store lands in RAM;
@  3. LDRBT and post-indexed LDRB with Rt = PC (t == 15 UNPREDICTABLE): the
@     access is performed (the harness MMIO device records it) and the base is
@     written back; the loaded byte is discarded;
@  4. multiply-group encodings with hw2[7:6] != 00 (the DSP SMLA<x><y> forms)
@     are UNDEFINED on a Cortex-M3: UsageFault UNDEFINSTR.
@ Every result goes to the harness MMIO log (tests/mcu/core/isa-edge.test.ts).
  .include "common.inc"

  .text
  .thumb_func
  .global reset
reset:
  INIT_RAM
  STW SHCSR, (1 << 18)          @ USGFAULTENA
  @ ---- 1: SP[1:0] are written as zero
  mov r9, sp
  LDC r0, 0x20004ff3
  mov.w sp, r0
  mov r1, sp
  LOGR r1                       @ 0x20004ff0
  movs r2, #7
  add.w sp, sp, r2
  mov r1, sp
  LOGR r1                       @ 0x20004ff7 → 0x20004ff4
  sub.w sp, sp, r2, lsl #1
  mov r1, sp
  LOGR r1                       @ 0x20004ff4 - 14 = 0x20004fe6 → 0x20004fe4
  LDC r3, odd_sp
  ldr.w sp, [r3]
  mov r1, sp
  LOGR r1                       @ 0x20004f8f → 0x20004f8c
  ldr r0, [sp], #3
  mov r1, sp
  LOGR r1                       @ 0x20004f8f → 0x20004f8c
  movs r6, #1
  sub.w r3, r3, #4
  ldr.w sp, [r3, r6, lsl #2]    @ LDR SP, [Rn, Rm, LSL #2] reads odd_sp again
  mov r1, sp
  LOGR r1                       @ 0x20004f8c
  mov sp, r9
  @ ---- 2: STRD r0, r1, [PC, #4] executed from SRAM
  LDC r0, 0x11111111
  LDC r1, 0x22222222
  LDC r4, strd_pc + 1
  blx r4
  LDC r4, strd_pc
  ldr r2, [r4, #8]
  LOGR r2                       @ 0x11111111
  ldr r2, [r4, #12]
  LOGR r2                       @ 0x22222222
  @ ---- 3: byte loads to PC: the read happens, the result is discarded, the base is written back
  LDC r5, M_DATA
  .global ldrbt_pc
ldrbt_pc:
  .inst.w 0xf815fe00            @ ldrbt pc, [r5]
  LOGI 0xe003
  .global ldrb_pc_wb
ldrb_pc_wb:
  .inst.w 0xf815fb04            @ ldrb pc, [r5], #4
  LOGR r5                       @ M_DATA + 4
  @ ---- 4: DSP multiply-group encodings → UsageFault UNDEFINSTR (the handler logs and skips them)
  .global smlabb
smlabb:
  .inst.w 0xfb026cc4            @ SMLABB r12, r2, r4, r6 (DSP)
  .global mul_op2
mul_op2:
  .inst.w 0xfb06f5c3            @ multiply group, op1 = 000, hw2[7:4] = 1100
  LOGI 0xe004
  bkpt #0

  .thumb_func
UsageFault_Handler:
  LOGI 0xfa17
  LOGM CFSR
  mrs r1, msp
  ldr r2, [r1, #24]
  LOGR r2                       @ stacked PC = the faulting instruction
  LDC r12, CFSR
  ldr r0, [r12]
  str r0, [r12]
  adds r2, #4
  str r2, [r1, #24]
  bx lr

  .align 2
odd_sp:
  .word 0x20004f8f

  .ltorg
  UNEXPECTED
  VECTORS_AUTO

  @ copied to SRAM by INIT_RAM and executed there
  .data
  .align 2
  .global strd_pc
strd_pc:
  .inst.w 0xe9cf0101            @ strd r0, r1, [pc, #4]: address = strd_pc + 4 + 4
  bx lr
  nop
  .word 0, 0
