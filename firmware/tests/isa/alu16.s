@ alu16: every 16-bit data-processing encoding (A5.2.1-A5.2.3), outside and
@ inside IT blocks (16-bit DP instructions set flags only outside IT).
  .include "common.inc"
  VECTORS_MIN
  .text
  .thumb_func
  .global reset
reset:
  LDC r8, results
  @ A5.2.1 shift (immediate), add, subtract, move, compare
  VEC12 "lsls r0, r1, #1"
  VEC12 "lsls r0, r1, #31"
  VEC12 "movs r0, r1"
  VEC12 "lsrs r0, r1, #1"
  VEC12 "lsrs r0, r1, #32"
  VEC12 "asrs r0, r1, #7"
  VEC12 "asrs r0, r1, #32"
  VEC12 "adds r0, r1, r2"
  VEC12 "subs r0, r1, r2"
  VEC12 "adds r0, r1, #7"
  VEC12 "subs r0, r1, #7"
  VEC12 "movs r0, #200"
  VEC12 "cmp r1, #200"
  VEC12 "adds r1, #200"
  VEC12 "subs r1, #255"
  @ A5.2.2 data processing
  VEC12 "ands r1, r2"
  VEC12 "eors r1, r2"
  VEC12 "lsls r1, r2"
  VEC12 "lsrs r1, r2"
  VEC12 "asrs r1, r2"
  VEC12 "adcs r1, r2"
  VEC12 "sbcs r1, r2"
  VEC12 "rors r1, r2"
  VEC12 "tst r1, r2"
  VEC12 "rsbs r0, r1, #0"
  VEC12 "cmp r1, r2"
  VEC12 "cmn r1, r2"
  VEC12 "orrs r1, r2"
  VEC12 "muls r1, r2, r1"
  VEC12 "bics r1, r2"
  VEC12 "mvns r0, r1"
  @ A5.2.3 high registers (no flags except CMP)
  VEC12 "mov r9, r1; add r9, r2; mov r0, r9"
  VEC12 "mov r10, r2; add r1, r10"
  VEC12 "mov r11, r1; cmp r11, r2"
  VEC12 "mov r12, r2; cmp r1, r12"
  @ inside IT blocks the same 16-bit encodings do not set flags
  VEC12 "it eq; addeq r0, r1, r2"
  VEC12 "it ne; subne r0, r1, r2"
  VEC12 "it cs; lslcs r0, r1, #3"
  VEC12 "it mi; andmi r1, r2"
  VEC12 "it pl; mvnpl r0, r1"
  VEC12 "it vs; mulvs r1, r2, r1"
  VEC12 "it ge; movge r0, #77"
  VEC12 "ite gt; addgt r1, #9; suble r1, #9"
  VEC12 "itt hi; asrhi r0, r1, #2; rsbhi r0, r0, #0"
  VEC12 "itte ls; lsrls r1, r2; orrls r1, r2; eorhi r1, r2"
  @ 32-bit flag-setting forms inside IT do set flags
  VEC12 "it lt; addslt.w r0, r1, r2"
  bkpt #0
  UNEXPECTED
  .ltorg

  .bss
  .align 2
results: .space 47 * 12 * 12
