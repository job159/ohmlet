@ branch: B<cond> (16- and 32-bit) for all 14 conditions x 16 NZCV
@ combinations, IT/ITE/ITTE blocks for every condition, branches at the end
@ of IT blocks, CBZ/CBNZ, TBB/TBH, B.W/BL across distance, BX/BLX
@ interworking, MOV/ADD/LDR/POP/LDM writing the PC, PC-relative ADD/MOV/ADR
@ and 16-bit literal loads.
  .include "common.inc"
  VECTORS_MIN

@ B<cond> taken → r0 = 1 (narrow = 16-bit encoding, .w = 32-bit over a gap)
.macro BCASE cond, f
  LDC r4, (\f << 28)
  msr APSR_nzcvq, r4
  b\cond 1f
  movs r0, #0
  b 2f
1:
  movs r0, #1
2:
  REC r0
.endm
.macro BCASEW cond, f
  LDC r4, (\f << 28)
  msr APSR_nzcvq, r4
  b\cond\().w 1f
  movs r0, #0
  b.w 2f
  .space 300
1:
  movs r0, #1
2:
  REC r0
.endm
@ run macro \m with every NZCV combination 0..15
.macro ALLFLAGS mac, arg
  \mac \arg, 0
  \mac \arg, 1
  \mac \arg, 2
  \mac \arg, 3
  \mac \arg, 4
  \mac \arg, 5
  \mac \arg, 6
  \mac \arg, 7
  \mac \arg, 8
  \mac \arg, 9
  \mac \arg, 10
  \mac \arg, 11
  \mac \arg, 12
  \mac \arg, 13
  \mac \arg, 14
  \mac \arg, 15
.endm
@ itete <c>: r0 = 5 / r1 = 0 when <c> holds, else r0 = 0 / r1 = 10
.macro ITCASE c, ic, f
  movs r0, #0
  movs r1, #0
  LDC r4, (\f << 28)
  msr APSR_nzcvq, r4
  itete \c
  mov\c r0, #1
  mov\ic r1, #2
  add\c r0, r0, #4
  add\ic r1, r1, #8
  REC r0
  REC r1
.endm

  .text
  .align 2
back_lit:
  .word 0

  .thumb_func
  .global reset
reset:
  LDC r8, results

  @ ---- conditional branches: r0 = 1 when taken (slots 0..223, cond-major)
  .irp cond, eq, ne, cs, cc, mi, pl, vs, vc, hi, ls, ge, lt, gt, le
  ALLFLAGS BCASE, \cond
  .endr

  @ ---- 32-bit B<cond>.W over a gap (slots 224..447)
  .irp cond, eq, ne, cs, cc, mi, pl, vs, vc, hi, ls, ge, lt, gt, le
  ALLFLAGS BCASEW, \cond
  .endr

  @ ---- IT blocks: itete <c>: r0 = 5 / r1 = 0 when <c> holds, else r0 = 0 / r1 = 10 (slots 448..895)
  .irp pair, "eq,ne", "ne,eq", "cs,cc", "cc,cs", "mi,pl", "pl,mi", "vs,vc", "vc,vs", "hi,ls", "ls,hi", "ge,lt", "lt,ge", "gt,le", "le,gt"
  ALLFLAGS ITCASE, "\pair"
  .endr

  @ ---- branch as the last instruction of an IT block (slots 896..899)
  movs r0, #0
  cmp r0, #0
  itt eq
  addeq r0, #1
  beq 1f
  movs r0, #99
1:
  REC r0
  cmp r0, #0
  ite eq
  moveq r0, #50
  bne.w 2f
  movs r0, #98
2:
  REC r0
  LDC r3, it_target
  cmp r0, r0
  it eq
  bxeq r3
  movs r0, #97
  REC r0
  b 3f
  .thumb_func
it_target:
  movs r0, #7
  REC r0
3:
  cmp r0, #8
  it lt
  bllt func_inc
  REC r0

  @ ---- CBZ / CBNZ (slots 900..903)
  movs r0, #0
  movs r1, #1
  cbz r0, 1f
  movs r1, #2
1:
  REC r1
  cbnz r0, 2f
  movs r1, #3
2:
  REC r1
  movs r0, #5
  cbz r0, 3f
  movs r1, #4
3:
  REC r1
  cbnz r0, 4f
  movs r1, #5
4:
  REC r1

  @ ---- TBB / TBH (slots 904..911)
  .irp idx, 0, 1, 2, 3
  movs r1, #\idx
  tbb [pc, r1]
1:
  .byte (5f - 1b) / 2, (6f - 1b) / 2, (7f - 1b) / 2, (8f - 1b) / 2
5:
  movs r0, #10
  b 9f
6:
  movs r0, #11
  b 9f
7:
  movs r0, #12
  b 9f
8:
  movs r0, #13
9:
  REC r0
  .endr
  .irp idx, 0, 1, 2, 3
  movs r1, #\idx
  adr r2, 1f
  tbh [r2, r1, lsl #1]
3:
  .align 2
1:
  .short (5f - 3b) / 2, (6f - 3b) / 2, (7f - 3b) / 2, (8f - 3b) / 2
5:
  movs r0, #20
  b 9f
6:
  movs r0, #21
  b 9f
  .space 600
7:
  movs r0, #22
  b 9f
8:
  movs r0, #23
9:
  REC r0
  .endr
  @ TBB/TBH with a register base: the branch is still relative to PC
  movs r1, #2
  adr r2, tbb_table
  tbb [r2, r1]
tbb_base:
  movs r0, #30
  b tbb_done
tbb_c1:
  movs r0, #31
  b tbb_done
tbb_c2:
  movs r0, #32
tbb_done:
  REC r0

  @ ---- BL / BLX / BX / PC writes (slots 912..)
  movs r0, #0
  bl func_inc
ret_bl:
  REC r0
  REC r6
  LDC r3, func_inc
  blx r3
ret_blx:
  REC r0
  REC r6
  LDC r3, bx_target
  bx r3
  movs r0, #96
  .thumb_func
bx_target:
  REC r0
  @ MOV PC, Rm and ADD PC, Rm: BranchWritePC (bit 0 ignored, no interworking)
  LDC r3, mov_target
  mov pc, r3
  movs r0, #95
  .thumb_func
mov_target:
  adds r0, #1
  REC r0
  adr r3, add_base
  movs r2, #2 @ add_target - add_base (one 16-bit instruction)
  add r2, r3
  mov pc, r2
  .align 2
add_base:
  movs r0, #94
add_target:
  adds r0, #1
  REC r0
  @ LDR PC, POP PC, LDM PC (LoadWritePC)
  LDC r3, ldr_slot
  LDC r4, ldr_target
  str r4, [r3]
  ldr pc, [r3]
  movs r0, #93
  .thumb_func
ldr_target:
  adds r0, #1
  REC r0
  LDC r4, pop_target
  push {r4}
  pop {pc}
  movs r0, #92
  .thumb_func
pop_target:
  adds r0, #1
  REC r0
  LDC r4, ldm_target
  LDC r3, ldr_slot
  str r4, [r3, #4]
  movs r5, #77
  str r5, [r3]
  ldm.w r3, {r5, pc}
  movs r0, #91
  .thumb_func
ldm_target:
  REC r5
  @ far B.W / BL (T4, +-16 MiB encodings)
  b.w far_fwd
far_back:
  REC r0
  b 4f
  .space 2000
far_fwd:
  movs r0, #61
  b.w far_back
4:
  bl far_func
  REC r0

  @ ---- PC-relative reads
  b 5f
  .align 2
near_back:
  .word 0
5:
  movs r0, #0
pc_add:
  add r0, pc
  REC r0
pc_mov:
  mov r1, pc
  REC r1
  adr r0, lit16
  REC r0
  ldr r0, lit16
  REC r0
  adr.w r0, near_back
  REC r0
  adr r0, lit16 + 4
  REC r0
  bkpt #0

  .thumb_func
func_inc:
  adds r0, #1
  mov r6, lr
  bx lr

  .align 2
lit16:
  .word 0x600dc0de
  .word 0
  .align 2
tbb_table:
  .byte 0, (tbb_c1 - tbb_base) / 2, (tbb_c2 - tbb_base) / 2, 0
  .thumb_func
far_func:
  movs r0, #62
  bx lr
  UNEXPECTED

  .bss
  .align 2
ldr_slot: .space 8
results: .space 4 * 1024
