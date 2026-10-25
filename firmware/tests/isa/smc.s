@ smc: code executed from SRAM and modified after it has run (the decoded-
@ instruction cache must follow SystemBus.codeVersion / codeWriteRange), plus
@ a 32-bit instruction patched in its second halfword only.
  .include "common.inc"
  VECTORS_MIN

  .text
  .thumb_func
  .global reset
reset:
  INIT_RAM
  LDC r0, func_template
  bic r0, r0, #1
  LDC r1, ram_func
  movs r2, #8
1:
  ldrh r3, [r0], #2
  strh r3, [r1], #2
  subs r2, #1
  bne 1b
  LDC r4, ram_func + 1
  blx r4
  LOGR r0                      @ 5
  LDC r1, ram_func
  movw r2, #0x2009             @ movs r0, #9
  strh r2, [r1]
  dsb
  isb
  blx r4
  LOGR r0                      @ 9
  @ patch only the second halfword of the 32-bit movw r1, #0x1234 → #0x1277
  LDC r1, ram_func + 2
  ldrh r2, [r1, #2]
  bic r2, r2, #0xff
  orr r2, r2, #0x77
  strh r2, [r1, #2]
  isb
  blx r4
  LOGR r1                      @ 0x1277
  bkpt #0

  .align 2
  .thumb_func
func_template:
  movs r0, #5
  movw r1, #0x1234
  bx lr
  nop
  nop
  nop
  nop
  UNEXPECTED

  .bss
  .align 2
ram_func: .space 32
