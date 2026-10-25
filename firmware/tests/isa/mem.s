@ mem: every load/store form (A5.2.4, A5.3.5-A5.3.10): immediate, register,
@ literal, pre/post-indexed, unaligned word/halfword, LDRD/STRD, LDM/STM/
@ PUSH/POP, LDRT/STRT, LDREX/STREX(B/H)/CLREX, SRAM bit-banding.
@ Each REC appends one word to `results`; tests/mcu/core/isa-mem.test.ts
@ derives the expectation of every slot from the pattern bytes.
  .include "common.inc"
  VECTORS_MIN

  .text
  .align 2
lit_back:
  .word 0x0badf00d

  .thumb_func
  .global reset
reset:
  INIT_RAM
  LDC r8, results
  LDC r9, pattern + 32
  movs r10, #3
  @ ---- single loads, immediate / register offsets (slots 0..18)
  ldr r0, [r9]
  REC r0
  ldr r0, [r9, #4]
  REC r0
  ldr.w r0, [r9, #1]
  REC r0
  ldr r0, [r9, #-4]
  REC r0
  ldrb r0, [r9, #3]
  REC r0
  ldrb.w r0, [r9, #-1]
  REC r0
  ldrh r0, [r9, #2]
  REC r0
  ldrh.w r0, [r9, #-2]
  REC r0
  ldrsb r0, [r9, r10]
  REC r0
  ldrsb.w r0, [r9, #5]
  REC r0
  ldrsh r0, [r9, r10]
  REC r0
  ldrsh.w r0, [r9, #-6]
  REC r0
  ldrh.w r0, [r9, #1]
  REC r0
  ldr.w r0, [r9, r10, lsl #2]
  REC r0
  ldrb.w r0, [r9, r10, lsl #1]
  REC r0
  ldr r0, [r9, r10]
  REC r0
  ldrh r0, [r9, r10]
  REC r0
  ldrb r0, [r9, r10]
  REC r0
  ldrsh.w r0, [r9, r10, lsl #1]
  REC r0
  @ ---- literals (slots 19..23)
  ldr r0, lit1
  REC r0
  ldr.w r0, lit_back
  REC r0
  ldrb.w r0, lit1
  REC r0
  ldrsh.w r0, lit1 + 2
  REC r0
  ldrsb.w r0, lit1 + 3
  REC r0
  @ ---- pre/post-indexed with writeback (slots 24..39: value, base offset)
  mov r11, r9
  ldr r0, [r11, #4]!
  REC r0
  sub r1, r11, r9
  REC r1
  ldr r0, [r11], #-8
  REC r0
  sub r1, r11, r9
  REC r1
  ldrb r0, [r11, #1]!
  REC r0
  sub r1, r11, r9
  REC r1
  ldrsb r0, [r11], #3
  REC r0
  sub r1, r11, r9
  REC r1
  ldrh r0, [r11, #-2]!
  REC r0
  sub r1, r11, r9
  REC r1
  ldrsh r0, [r11], #6
  REC r0
  sub r1, r11, r9
  REC r1
  ldrsb r0, [r11, #-1]!
  REC r0
  sub r1, r11, r9
  REC r1
  ldrh r0, [r11], #-3
  REC r0
  sub r1, r11, r9
  REC r1
  @ ---- LDRD (slots 40..52)
  ldrd r0, r1, [r9, #8]
  REC r0
  REC r1
  ldrd r0, r1, [r9, #-8]
  REC r0
  REC r1
  mov r11, r9
  ldrd r0, r1, [r11, #16]!
  REC r0
  REC r1
  sub r2, r11, r9
  REC r2
  ldrd r0, r1, [r11], #-24
  REC r0
  REC r1
  sub r2, r11, r9
  REC r2
  ldrd r0, r1, lit_d
  REC r0
  REC r1
  @ ---- LDM (slots 53..64)
  mov r11, r9
  ldmia r11!, {r0-r3}
  REC r0
  REC r1
  REC r2
  REC r3
  sub r4, r11, r9
  REC r4
  ldmdb r11!, {r0, r2, r5}
  REC r0
  REC r2
  REC r5
  sub r4, r11, r9
  REC r4
  mov r1, r9
  ldm r1, {r0, r1}
  REC r0
  REC r1
  mov r11, r9
  ldm.w r11, {r0-r2}
  sub r4, r11, r9
  REC r4

  @ ---- stores into buf (r12 = buf), dumped afterwards
  LDC r12, buf
  LDC r0, 0x11223344
  LDC r1, 0xa5b6c7d8
  movs r10, #4
  str r0, [r12]
  strb r1, [r12, #4]
  strh r1, [r12, #6]
  str.w r1, [r12, #9]
  strh.w r0, [r12, #13]
  str.w r0, [r12, r10, lsl #2]
  strb r0, [r12, r10]
  mov r11, r12
  str r1, [r11, #20]!
  sub r2, r11, r12
  REC r2
  strb r0, [r11], #-1
  sub r2, r11, r12
  REC r2
  strh r0, [r11, #5]!
  sub r2, r11, r12
  REC r2
  strd r0, r1, [r12, #32]
  add r11, r12, #24
  strd r1, r0, [r11, #16]!
  sub r2, r11, r12
  REC r2
  strd r0, r0, [r11], #-8
  sub r2, r11, r12
  REC r2
  add r11, r12, #48
  stmia r11!, {r0, r1, r10}
  sub r2, r11, r12
  REC r2
  stmdb r11!, {r1, r10}
  sub r2, r11, r12
  REC r2
  mov r3, r11
  stm r3!, {r0}
  sub r2, r3, r12
  REC r2
  mov r5, sp
  push {r0, r1, r10}
  mov r6, sp
  sub r6, r5, r6
  REC r6
  pop {r2, r3, r4}
  REC r2
  REC r3
  REC r4
  mov r6, sp
  sub r6, r5, r6
  REC r6
  push.w {r0, r1, r9, lr}
  pop.w {r2, r3, r4, r7}
  REC r2
  REC r3
  REC r4
  @ unprivileged forms (executed privileged: plain accesses to SRAM)
  strt r1, [r12, #60]
  ldrt r2, [r12, #60]
  REC r2
  strbt r0, [r12, #58]
  ldrbt r2, [r12, #58]
  REC r2
  ldrsbt r2, [r12, #63]
  REC r2
  strht r0, [r12, #56]
  ldrht r2, [r12, #56]
  REC r2
  ldrsht r2, [r12, #62]
  REC r2
  @ dump buf (16 words)
  ldmia r12, {r0-r7}
  stmia r8!, {r0-r7}
  add r11, r12, #32
  ldmia r11, {r0-r7}
  stmia r8!, {r0-r7}

  @ ---- exclusives
  LDC r0, 0x11223344
  LDC r1, 0xa5b6c7d8
  ldrex r2, [r12]
  REC r2
  strex r3, r1, [r12]
  REC r3
  strex r3, r0, [r12]
  REC r3
  add r11, r12, #4
  ldrexb r2, [r11]
  REC r2
  strexb r3, r0, [r11]
  REC r3
  ldrexh r2, [r11]
  REC r2
  clrex
  strexh r3, r1, [r11]
  REC r3
  ldrex r2, [r12, #8]
  REC r2
  strex r3, r0, [r12, #8]
  REC r3
  add r11, r12, #14
  ldrexh r2, [r11]
  REC r2
  strexh r3, r1, [r11]
  REC r3
  ldr r2, [r12]
  REC r2
  ldr r2, [r12, #4]
  REC r2
  ldr r2, [r12, #8]
  REC r2
  ldr r2, [r12, #12]
  REC r2

  @ ---- SRAM bit-band alias (0x22000000 + offset*32 + bit*4)
  LDC r11, buf
  sub r11, r11, #0x20000000
  lsl r11, r11, #5
  add r11, r11, #0x22000000
  movs r0, #1
  movs r1, #0
  str r0, [r11, #5 * 4]          @ buf[0] bit 5 = 1
  str r1, [r11, #(8 + 0) * 4]    @ buf[1] bit 0 = 0
  str r0, [r11, #(31 * 4)]       @ buf[3] bit 7 = 1
  strb r0, [r11, #(8 * 2 + 3) * 4] @ buf[2] bit 3 = 1 (byte-sized alias access)
  ldr r2, [r11, #5 * 4]
  REC r2
  ldr r2, [r11, #4 * 4]
  REC r2
  ldr r2, [r11, #(8 * 4 + 1) * 4]
  REC r2
  ldrh r2, [r11, #(8 + 1) * 4]
  REC r2
  ldr r2, [r12]
  REC r2

  @ ---- 16-bit encodings with low registers
  LDC r6, pattern + 32
  movs r7, #3
  ldr r0, [r6, #4]
  REC r0
  ldrb r0, [r6, #7]
  REC r0
  ldrh r0, [r6, #6]
  REC r0
  ldr r0, [r6, r7]
  REC r0
  ldrb r0, [r6, r7]
  REC r0
  ldrh r0, [r6, r7]
  REC r0
  ldrsb r0, [r6, r7]
  REC r0
  ldrsh r0, [r6, r7]
  REC r0
  ldr r0, lit1
  REC r0
  adr r1, lit1
  REC r1
  ldr r0, [r1]
  REC r0
  sub sp, #16
  str r0, [sp, #4]
  ldr r2, [sp, #4]
  REC r2
  add r3, sp, #4
  ldr r4, [r3]
  REC r4
  add sp, #16
  LDC r6, buf
  movs r7, #2
  LDC r0, 0x89abcdef
  str r0, [r6, #4]
  strh r0, [r6, #10]
  strb r0, [r6, #13]
  str r0, [r6, r7]
  movs r7, #9
  strh r0, [r6, r7]
  movs r7, #15
  strb r0, [r6, r7]
  mov r5, r6
  ldm r5!, {r0, r1, r2, r3}
  stmia r8!, {r0, r1, r2, r3}
  subs r4, r5, r6
  REC r4
  stm r5!, {r0, r1}
  subs r4, r5, r6
  REC r4
  ldr r0, [r6, #16]
  REC r0
  ldr r0, [r6, #20]
  REC r0
  bkpt #0
  UNEXPECTED

  .align 2
  .global lit1
lit1:
  .word 0xcafef00d
lit_d:
  .word 0x01020304, 0xf0e0d0c0
  .ltorg

  .section .rodata
  .align 2
  .global pattern
pattern:
  .set i, 0
  .rept 64
  .byte (0x93 * i + 0x17) & 0xff
  .set i, i + 1
  .endr

  .bss
  .align 3
buf: .space 64
results: .space 4 * 160
