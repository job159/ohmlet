@ exc_stack: reset with an unaligned initial SP (ST's linker scripts may set
@ _estack = 0x20004FFF; SP_main[1:0] are RAZ so SP = 0x20004FFC), and
@ exception-frame alignment per CCR.STKALIGN with the xPSR[9] marker
@ (B1.5.6/B1.5.7). Logs: reset SP, CCR, then for each SVC the handler's SP
@ and stacked xPSR, and the Thread SP after the return.
  .include "common.inc"

  .text
  .thumb_func
  .global reset
reset:
  mov r0, sp
  LOGR r0
  LOGM CCR
  svc #0
  mov r0, sp
  LOGR r0
  STW CCR, 0x200                @ STKALIGN = 1
  svc #0
  mov r0, sp
  LOGR r0
  STW CCR, 0                    @ STKALIGN = 0
  svc #0
  mov r0, sp
  LOGR r0
  bkpt #0

  .thumb_func
SVC_Handler:
  mov r0, sp
  LOGR r0
  ldr r0, [sp, #28]
  LOGR r0
  bx lr

  UNEXPECTED

  .section .isr_vector, "a"
  .word 0x20004fff              @ deliberately unaligned initial SP
  .word reset
  .rept 9
  .word unexpected
  .endr
  .word SVC_Handler
  .rept 4
  .word unexpected
  .endr
