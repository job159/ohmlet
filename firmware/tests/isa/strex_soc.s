@ strex_soc: the HAL's ATOMIC_SET_BIT / ATOMIC_CLEAR_BIT (stm32f1xx.h: a
@ __LDREXW / __STREXW retry loop) on the USART1 control registers of the
@ STM32F103 SoC model. Run by tests/mcu/core/directed.test.ts on the real SoC
@ (src/mcu/stm32f1) with the real core: the STREX to a peripheral register
@ must succeed, and an interrupt between LDREX and STREX (pended through
@ NVIC_STIR, USART1 = IRQ 37) must make exactly one attempt fail.
@ results[]: attempts, CR1, attempts, CR3, IRQ count, attempts, CR1.
  .include "common.inc"

  .equ RCC_APB2ENR, 0x40021018
  .equ USART1_CR1,  0x4001380c
  .equ USART1_CR3,  0x40013814
  .equ NVIC_ISER1,  0xe000e104

  .text
  .thumb_func
  .global reset
reset:
  INIT_RAM
  ldr r8, =results
  LDC r0, RCC_APB2ENR       @ USART1EN (RM0008 §7.3.7)
  ldr r1, [r0]
  orr r1, r1, #(1 << 14)
  str r1, [r0]
  STW NVIC_ISER1, (1 << 5)  @ IRQ 37
  @ ATOMIC_SET_BIT(USART1->CR1, USART_CR1_UE | USART_CR1_TE)
  LDC r0, USART1_CR1
  LDC r4, 0x2008
  movs r5, #0
1:
  adds r5, #1
  ldrex r1, [r0]
  orr r1, r1, r4
  strex r2, r1, [r0]
  cmp r2, #0
  bne 1b
  REC r5
  ldr r1, [r0]
  REC r1
  @ ATOMIC_SET_BIT(USART1->CR3, USART_CR3_DMAT), interrupted once between LDREX and STREX
  LDC r0, USART1_CR3
  movs r5, #0
2:
  adds r5, #1
  ldrex r1, [r0]
  orr r1, r1, #0x80
  cmp r5, #1
  bne 3f
  STW STIR, 37
3:
  strex r2, r1, [r0]
  cmp r2, #0
  bne 2b
  REC r5
  ldr r1, [r0]
  REC r1
  ldr r1, =irq_count
  ldr r1, [r1]
  REC r1
  @ ATOMIC_CLEAR_BIT(USART1->CR1, USART_CR1_TE)
  LDC r0, USART1_CR1
  movs r5, #0
4:
  adds r5, #1
  ldrex r1, [r0]
  bic r1, r1, #0x8
  strex r2, r1, [r0]
  cmp r2, #0
  bne 4b
  REC r5
  ldr r1, [r0]
  REC r1
  bkpt #0

  .thumb_func
USART1_IRQHandler:
  ldr r0, =irq_count
  ldr r1, [r0]
  adds r1, #1
  str r1, [r0]
  bx lr

  .ltorg
  UNEXPECTED

  .section .isr_vector, "a"
  .word _estack
  .word reset
  .rept 14 + 37
  .word unexpected
  .endr
  .word USART1_IRQHandler   @ 16 + 37
  .rept 5
  .word unexpected
  .endr

  .bss
  .align 2
irq_count: .space 4
results: .space 64
