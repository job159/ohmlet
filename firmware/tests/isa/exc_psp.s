@ exc_psp: RTOS-style preemptive context switch. Two Thread-mode tasks run
@ unprivileged-style on the process stack (CONTROL.SPSEL = 1); SysTick pends
@ PendSV every 700 cycles and PendSV (lowest priority) saves r4-r11 on the
@ outgoing task's PSP and restores the other task's — the classic Cortex-M
@ scheduler. Each task keeps a register signature in r4-r11 and checks it on
@ every loop iteration (bkpt #0xbd on corruption); both counters must reach
@ TARGET, then task A halts with bkpt #0.
  .include "common.inc"
  .equ TARGET, 400

  .text
  .thumb_func
  .global reset
reset:
  INIT_RAM
  @ initial frame for task B: r4-r11 (8 words) below the exception frame
  LDC r0, stackB_top - 64
  movs r1, #0
  movs r2, #0
1:
  str r2, [r0, r1, lsl #2]
  adds r1, #1
  cmp r1, #16
  bne 1b
  LDC r2, taskB
  bic r2, r2, #1                @ a stacked return address has bit 0 clear
  str r2, [r0, #(8 + 6) * 4]    @ stacked PC
  LDC r2, 0x01000000
  str r2, [r0, #(8 + 7) * 4]    @ stacked xPSR: T bit
  LDC r1, tcb
  str r0, [r1, #4]
  @ priorities: PendSV lowest (0xF0), SysTick 0x80
  STW SHPR3, 0x80f00000
  STW STRVR, 699
  STW STCVR, 0
  STW STCSR, 7                  @ ENABLE | TICKINT | CLKSOURCE (core clock)
  @ switch Thread mode to the process stack and start task A
  LDC r0, stackA_top
  msr psp, r0
  movs r0, #2
  msr control, r0
  isb
  b taskA

  .thumb_func
taskA:
  LDC r4, 0xa4
  LDC r5, 0xa5
  LDC r6, 0xa6
  LDC r7, 0xa7
  LDC r8, 0xa8
  LDC r9, 0xa9
  LDC r10, 0xaa
  LDC r11, 0xab
1:
  ldr r0, =countA
  ldr r1, [r0]
  adds r1, #1
  str r1, [r0]
  cmp r4, #0xa4
  bne bad
  cmp r5, #0xa5
  bne bad
  cmp r6, #0xa6
  bne bad
  cmp r7, #0xa7
  bne bad
  cmp r8, #0xa8
  bne bad
  cmp r9, #0xa9
  bne bad
  cmp r10, #0xaa
  bne bad
  cmp r11, #0xab
  bne bad
  ldr r2, =countB
  ldr r2, [r2]
  cmp r1, #TARGET
  blo 1b
  cmp r2, #TARGET
  blo 1b
  bkpt #0

  .thumb_func
taskB:
  LDC r4, 0xb4
  LDC r5, 0xb5
  LDC r6, 0xb6
  LDC r7, 0xb7
  LDC r8, 0xb8
  LDC r9, 0xb9
  LDC r10, 0xba
  LDC r11, 0xbb
1:
  ldr r0, =countB
  ldr r1, [r0]
  adds r1, #1
  str r1, [r0]
  cmp r4, #0xb4
  bne bad
  cmp r5, #0xb5
  bne bad
  cmp r6, #0xb6
  bne bad
  cmp r7, #0xb7
  bne bad
  cmp r8, #0xb8
  bne bad
  cmp r9, #0xb9
  bne bad
  cmp r10, #0xba
  bne bad
  cmp r11, #0xbb
  bne bad
  b 1b

bad:
  bkpt #0xbd

  .thumb_func
SysTick_Handler:
  ldr r0, =ticks
  ldr r1, [r0]
  adds r1, #1
  str r1, [r0]
  LDC r0, ICSR
  mov r1, #(1 << 28)
  str r1, [r0]                  @ PENDSVSET
  bx lr

  .thumb_func
PendSV_Handler:
  mrs r0, psp
  stmdb r0!, {r4-r11}
  ldr r1, =cur
  ldr r2, [r1]
  ldr r3, =tcb
  str r0, [r3, r2, lsl #2]
  eor r2, r2, #1
  str r2, [r1]
  ldr r0, [r3, r2, lsl #2]
  ldmia r0!, {r4-r11}
  msr psp, r0
  ldr r1, =switches
  ldr r2, [r1]
  adds r2, #1
  str r2, [r1]
  mov r0, lr
  LOGR r0                       @ EXC_RETURN: 0xFFFFFFFD (Thread, PSP)
  bx lr

  .ltorg
  UNEXPECTED
  VECTORS_AUTO

  .bss
  .align 3
  .global countA, countB, ticks, switches
countA: .space 4
countB: .space 4
ticks: .space 4
switches: .space 4
cur: .space 4
tcb: .space 8
  .align 3
stackA: .space 512
stackA_top:
stackB: .space 512
stackB_top:
