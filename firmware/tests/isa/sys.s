@ sys: MRS/MSR for every special register (B5.2.2/B5.2.3), CPSIE/CPSID,
@ BASEPRI_MAX rules, CONTROL.SPSEL/PSP switching, unprivileged Thread mode
@ (MSR/CPS/MRS restrictions, SVC back to privileged), hints and barriers.
  .include "common.inc"

  .section .isr_vector, "a"
  .word _estack
  .word reset
  .rept 9
  .word unexpected
  .endr
  .word svc_handler          @ 11 SVCall
  .rept 4
  .word unexpected
  .endr

  .text
  .thumb_func
  .global reset
reset:
  LDC r8, results
  @ ---- xPSR views in Thread mode (slots 0..7)
  LDC r1, 0xf8000000
  msr apsr_nzcvq, r1
  mrs r0, apsr
  REC r0
  mrs r0, xpsr
  REC r0
  mrs r0, ipsr
  REC r0
  mrs r0, epsr
  REC r0
  mrs r0, iapsr
  REC r0
  mrs r0, eapsr
  REC r0
  mrs r0, iepsr
  REC r0
  LDC r1, 0x50000000
  msr apsr_nzcvq, r1
  mrs r0, apsr
  REC r0
  @ ---- PRIMASK / FAULTMASK via CPS and MSR (slots 8..15)
  cpsid i
  mrs r0, primask
  REC r0
  cpsie i
  mrs r0, primask
  REC r0
  movs r1, #1
  msr primask, r1
  mrs r0, primask
  REC r0
  movs r1, #0
  msr primask, r1
  mrs r0, primask
  REC r0
  cpsid f
  mrs r0, faultmask
  REC r0
  cpsie f
  mrs r0, faultmask
  REC r0
  movs r1, #3
  msr faultmask, r1
  mrs r0, faultmask
  REC r0
  movs r1, #0
  msr faultmask, r1
  mrs r0, faultmask
  REC r0
  @ ---- BASEPRI (4 implemented priority bits) and BASEPRI_MAX (slots 16..21)
  movs r1, #0x45
  msr basepri, r1
  mrs r0, basepri
  REC r0
  movs r1, #0x80
  msr basepri_max, r1
  mrs r0, basepri
  REC r0
  movs r1, #0x20
  msr basepri_max, r1
  mrs r0, basepri_max
  REC r0
  movs r1, #0
  msr basepri_max, r1
  mrs r0, basepri
  REC r0
  msr basepri, r1
  mrs r0, basepri
  REC r0
  movs r1, #0x3f
  msr basepri_max, r1
  mrs r0, basepri
  REC r0
  movs r1, #0
  msr basepri, r1
  @ ---- MSP / PSP / CONTROL.SPSEL (slots 22..31)
  mrs r0, msp
  REC r0
  LDC r1, 0x20003003
  msr psp, r1
  mrs r0, psp
  REC r0
  mrs r0, control
  REC r0
  movs r1, #2
  msr control, r1
  isb
  mrs r0, control
  REC r0
  mov r0, sp
  REC r0
  push {r1}
  mrs r0, psp
  REC r0
  mrs r0, msp
  REC r0
  pop {r1}
  movs r1, #0
  msr control, r1
  isb
  mov r0, sp
  REC r0
  mrs r0, psp
  REC r0
  LDC r1, 0x20004ff6
  msr msp, r1
  mov r0, sp
  REC r0
  LDC r1, _estack
  msr msp, r1
  @ ---- unprivileged Thread mode (slots 32..39)
  movs r1, #1
  msr control, r1
  isb
  mrs r0, control
  REC r0
  movs r1, #1
  msr primask, r1          @ ignored when unprivileged
  mrs r0, primask
  REC r0
  cpsid i                  @ ignored when unprivileged
  mrs r0, primask
  REC r0
  movs r1, #0x40
  msr basepri, r1          @ ignored
  mrs r0, basepri
  REC r0
  mrs r0, msp              @ reads as zero when unprivileged
  REC r0
  movs r1, #0
  msr control, r1          @ ignored: cannot regain privilege from Thread mode
  mrs r0, control
  REC r0
  LDC r1, 0x10000000
  msr apsr_nzcvq, r1       @ APSR stays writable
  mrs r0, apsr
  REC r0
  svc #5                   @ handler clears CONTROL.nPRIV
  mrs r0, control
  REC r0
  @ ---- hints and barriers execute as NOPs; SEV sets the event register so WFE does not sleep
  nop
  nop.w
  yield
  yield.w
  dmb
  dsb
  isb
  clrex
  pld [r8]
  pli [r8]
  sev
  wfe
  sev.w
  wfe.w
  LDC r0, 0xc0ffee
  REC r0
  @ IPSR inside the handler, recorded by svc_handler (slot 40 written by handler)
  bkpt #0

  .thumb_func
svc_handler:
  mrs r0, ipsr
  REC r0
  mrs r0, control
  bic r0, r0, #1
  msr control, r0
  bx lr
  UNEXPECTED

  .bss
  .align 2
results: .space 4 * 64
