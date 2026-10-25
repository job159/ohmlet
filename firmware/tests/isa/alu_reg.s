@ alu_reg: 32-bit data processing (shifted register, A5.3.11) and
@ register-controlled shifts (A5.3.12)
  .include "common.inc"
  VECTORS_MIN
  .text
  .thumb_func
  .global reset
reset:
  LDC r8, results
  DP10 and
  DP10 bic
  DP10 orr
  DP10 orn
  DP10 eor
  DP10 add
  DP10 adc
  DP10 sub
  DP10 sbc
  DP10 rsb
  VEC6 "mov.w r0, r1"
  VEC6 "movs.w r0, r1"
  VEC6 "lsls.w r0, r1, #5"
  VEC6 "lsl.w r0, r1, #31"
  VEC6 "lsrs.w r0, r1, #32"
  VEC6 "asrs.w r0, r1, #32"
  VEC6 "asr.w r0, r1, #1"
  VEC6 "rors.w r0, r1, #3"
  VEC6 "rrxs r0, r1"
  VEC6 "rrx r0, r1"
  VEC6 "mvns.w r0, r1, lsl #3"
  VEC6 "mvn.w r0, r1, ror #4"
  VEC6 "mvns.w r0, r1"
  VEC6 "tst.w r1, r2, lsl #3"
  VEC6 "tst.w r1, r2"
  VEC6 "teq.w r1, r2, ror #31"
  VEC6 "teq.w r1, r2"
  VEC6 "cmp.w r1, r2, lsl #1"
  VEC6 "cmp.w r1, r2"
  VEC6 "cmn.w r1, r2, asr #2"
  VEC6 "cmn.w r1, r2"
  VEC12 "lsls.w r0, r1, r2"
  VEC12 "lsl.w r0, r1, r2"
  VEC12 "lsrs.w r0, r1, r2"
  VEC12 "asrs.w r0, r1, r2"
  VEC12 "asr.w r0, r1, r2"
  VEC12 "rors.w r0, r1, r2"
  VEC12 "ror.w r0, r1, r2"
  bkpt #0
  UNEXPECTED
  .ltorg

  .bss
  .align 2
results: .space (100 * 6 + 21 * 6 + 7 * 12) * 12
