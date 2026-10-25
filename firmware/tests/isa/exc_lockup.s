@ exc_lockup: a fault inside the HardFault handler cannot be escalated any
@ further: the core locks up (B1.5.15) and fetches from 0xFFFFFFFE. NMI has a
@ higher priority than HardFault, so a pended NMI leaves the lockup.
  .include "common.inc"

  .text
  .thumb_func
  .global reset
reset:
  LOGI 0x1
  .global udf_thread
udf_thread:
  udf #0                    @ UsageFault disabled → HardFault
  LOGI 0xbad

  .thumb_func
HardFault_Handler:
  LOGI 0x2
  LOGM HFSR
  .global udf_hardfault
udf_hardfault:
  udf #1                    @ fault at priority -1 → lockup
  LOGI 0xbad

  .thumb_func
NMI_Handler:
  LOGI 0x3
  mrs r0, ipsr
  LOGR r0
  ldr r0, [sp, #24]         @ stacked return address of the locked-up context
  LOGR r0
  bkpt #0

  UNEXPECTED
  VECTORS_AUTO
