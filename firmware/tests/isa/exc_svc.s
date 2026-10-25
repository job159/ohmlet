@ exc_svc: SVC and PendSV — stacking of the 8-word frame (B1.5.6), EXC_RETURN
@ values, return-value passing through the stacked r0, PendSV pended from
@ Thread mode, tail-chaining (lower-priority PendSV pended inside SVC) and
@ nesting (higher-priority PendSV preempts SVC). Everything observable goes
@ to the M_LOG device; tests/mcu/core/exceptions.test.ts checks the sequence.
  .include "common.inc"

  .text
  .thumb_func
  .global reset
reset:
  @ ---- 1: SVC #42 from Thread mode on MSP; the handler dumps the frame and bumps stacked r0
  LDC r4, 0x100e
  mov lr, r4
  LDC r4, 0x90000000
  msr apsr_nzcvq, r4
  LDC r0, 0x1000
  LDC r1, 0x1001
  LDC r2, 0x1002
  LDC r3, 0x1003
  LDC r12, 0x100c
  svc #42
  .global svc_ret
svc_ret:
  LOGR r0
  LOGR r1
  @ ---- 2: PendSV pended from Thread mode is taken at the next boundary
  STW ICSR, (1 << 28)
  LOGI 0x2000
  @ ---- 3: SVC (0x40) pends lower-priority PendSV (0xC0): tail-chained after SVC returns
  STW SHPR2, 0x40000000
  STW SHPR3, 0x00c00000
  svc #1
  LOGI 0x3000
  @ ---- 4: PendSV at 0x00 preempts the SVC handler (nested, EXC_RETURN 0xFFFFFFF1)
  STW SHPR3, 0x00000000
  svc #2
  LOGI 0x4000
  bkpt #0

  .thumb_func
SVC_Handler:
  mrs r0, ipsr
  LOGR r0
  LOGR lr
  ldr r1, [sp, #24]           @ stacked return address
  ldrb r2, [r1, #-2]          @ imm8 of the SVC instruction
  LOGR r2
  cmp r2, #42
  bne 1f
  ldr r0, [sp, #0]
  LOGR r0
  ldr r0, [sp, #4]
  LOGR r0
  ldr r0, [sp, #8]
  LOGR r0
  ldr r0, [sp, #12]
  LOGR r0
  ldr r0, [sp, #16]
  LOGR r0
  ldr r0, [sp, #20]
  LOGR r0
  ldr r0, [sp, #24]
  LOGR r0
  ldr r0, [sp, #28]
  LOGR r0
  ldr r0, [sp]
  adds r0, #1
  str r0, [sp]
  bx lr
1:
  STW ICSR, (1 << 28)
  LOGI 0x5100
  cmp r2, #1
  bne 2f
  @ time stamp right before the exception return (tail-chain timing)
  LDC r12, M_CYC
  ldr r0, [r12]
  LOGR r0
2:
  bx lr

  .thumb_func
PendSV_Handler:
  LDC r12, M_CYC
  ldr r0, [r12]
  LOGR r0
  LOGI 0xe0
  mrs r0, ipsr
  LOGR r0
  LOGR lr
  bx lr

  UNEXPECTED
  VECTORS_AUTO
