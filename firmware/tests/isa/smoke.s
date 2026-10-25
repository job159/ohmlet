@ smoke: a few instructions and a loop, then BKPT
  .include "common.inc"
  VECTORS_MIN

  .text
  .thumb_func
  .global reset
reset:
  INIT_RAM
  LDC r8, results
  movs r0, #0
  movs r1, #10
1:
  adds r0, r0, r1
  subs r1, #1
  bne 1b
  REC r0
  CASE "adds r0, r1, r2", 0, 0x7fffffff, 1, 0
  CASE "it eq; addeq r0, r1, r2", 5, 1, 2, 0, 0x40000000
  bkpt #0
  UNEXPECTED

  .bss
results: .space 256
