@ alu_misc: multiply (A5.3.16), long multiply / divide (A5.3.17), bit field,
@ saturate (A5.3.3), extend, reverse, CLZ, RBIT (A5.3.12, A5.3.15)
  .include "common.inc"
  VECTORS_MIN
  .text
  .thumb_func
  .global reset
reset:
  LDC r8, results
  VECMUL "mul r0, r2, r3"
  VECMUL "muls r2, r3, r2; mov r0, r2"
  VECMUL "mla r0, r2, r3, r1"
  VECMUL "mls r0, r2, r3, r1"
  VECMUL "umull r0, r1, r2, r3"
  VECMUL "smull r0, r1, r2, r3"
  VECMUL "umlal r0, r1, r2, r3"
  VECMUL "smlal r0, r1, r2, r3"
  VECMUL "smull r1, r0, r3, r2"
  VECDIV "sdiv r0, r1, r2"
  VECDIV "udiv r0, r1, r2"
  VEC12 "bfi r0, r1, #0, #1"
  VEC12 "bfi r0, r1, #4, #8"
  VEC12 "bfi r0, r1, #0, #32"
  VEC12 "bfi r0, r1, #31, #1"
  VEC12 "bfc r1, #3, #7"
  VEC12 "bfc r1, #0, #32"
  VEC12 "ubfx r0, r1, #0, #32"
  VEC12 "ubfx r0, r1, #4, #12"
  VEC12 "ubfx r0, r1, #31, #1"
  VEC12 "sbfx r0, r1, #4, #12"
  VEC12 "sbfx r0, r1, #0, #8"
  VEC12 "sbfx r0, r1, #31, #1"
  VEC12 "sbfx r0, r1, #0, #32"
  VEC12 "sxtb r0, r1"
  VEC12 "sxth r0, r1"
  VEC12 "uxtb r0, r1"
  VEC12 "uxth r0, r1"
  VEC12 "sxtb.w r0, r1, ror #8"
  VEC12 "sxth.w r0, r1, ror #16"
  VEC12 "uxtb.w r0, r1, ror #24"
  VEC12 "uxth.w r0, r1, ror #8"
  VEC12 "rev r0, r1"
  VEC12 "rev16 r0, r1"
  VEC12 "revsh r0, r1"
  VEC12 "rev.w r0, r1"
  VEC12 "rev16.w r0, r1"
  VEC12 "revsh.w r0, r1"
  VEC12 "rbit r0, r1"
  VEC12 "clz r0, r1"
  VEC12 "clz r0, r2"
  VECSAT "ssat r0, #8, r1"
  VECSAT "ssat r0, #1, r1"
  VECSAT "ssat r0, #32, r1"
  VECSAT "ssat r0, #16, r1, lsl #4"
  VECSAT "ssat r0, #8, r1, asr #3"
  VECSAT "ssat r0, #12, r1, asr #31"
  VECSAT "usat r0, #8, r1"
  VECSAT "usat r0, #0, r1"
  VECSAT "usat r0, #31, r1"
  VECSAT "usat r0, #16, r1, lsl #8"
  VECSAT "usat r0, #4, r1, asr #28"
  bkpt #0
  UNEXPECTED
  .ltorg

  .bss
  .align 2
results: .space (9 * 8 + 2 * 12 + 30 * 12 + 11 * 13) * 12
