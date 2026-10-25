@ spin: an endless Thread-mode counter loop with IRQ0/IRQ1/SysTick handlers
@ that only log — the host side of the tests drives IRQ lines, breakpoints,
@ stepping and the SysTick registers.
  .include "common.inc"

  .text
  .thumb_func
  .global reset
reset:
  STW ISER0, 0x3
  movs r0, #0
  .global spin_loop
spin_loop:
  adds r0, #1
  .global spin_branch
spin_branch:
  b spin_loop

  .thumb_func
IRQ0_Handler:
  LOGI 0x100
  bx lr

  .thumb_func
IRQ1_Handler:
  LOGI 0x101
  bx lr

  .thumb_func
SysTick_Handler:
  LOGI 0x115
  bx lr

  UNEXPECTED
  VECTORS_AUTO
