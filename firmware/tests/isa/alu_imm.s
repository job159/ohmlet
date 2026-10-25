@ alu_imm: data processing with modified immediates (A5.3.1, ThumbExpandImm_C
@ carry) and plain binary immediates (A5.3.3)
  .include "common.inc"
  VECTORS_MIN
  .text
  .thumb_func
  .global reset
reset:
  LDC r8, results
  DPI and
  DPI bic
  DPI orr
  DPI orn
  DPI eor
  DPI add
  DPI adc, " "
  DPI sub
  DPI sbc, " "
  DPI rsb
  VEC6 "movs.w r0, #0x00ab00ab"
  VEC6 "movs.w r0, #0x80000000"
  VEC6 "movs.w r0, #0x3fc"
  VEC6 "mov.w r0, #0xff000000"
  VEC6 "mvns.w r0, #0xabababab"
  VEC6 "mvns.w r0, #0x7f800000"
  VEC6 "mvn.w r0, #1"
  VEC6 "tst.w r1, #0x80000000"
  VEC6 "tst.w r1, #0xff"
  VEC6 "teq.w r1, #0xff000000"
  VEC6 "teq.w r1, #0x00ff00ff"
  VEC6 "cmp.w r1, #0x80000000"
  VEC6 "cmp.w r1, #1"
  VEC6 "cmn.w r1, #0xabababab"
  VEC6 "cmn.w r1, #1"
  VEC6 "addw r0, r1, #4095"
  VEC6 "addw r0, r1, #1"
  VEC6 "subw r0, r1, #4095"
  VEC6 "subw r0, r1, #0x800"
  VEC6 "movw r0, #0xffff"
  VEC6 "movw r0, #0"
  VEC6 "movt r0, #0xabcd"
  VEC6 "movt r1, #0; movt r0, #0xffff"
  bkpt #0
  UNEXPECTED
  .ltorg

  .bss
  .align 2
results: .space (90 + 23) * 6 * 12
