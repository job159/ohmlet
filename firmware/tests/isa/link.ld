/*
 * Linker script for the CPU instruction-set test programs (firmware/tests/isa):
 * STM32F103-like map, code and constants in flash, results in SRAM.
 * __cases_start/__cases_end delimit the case descriptors emitted by the
 * CASE macro of common.inc; results is the table the programs fill.
 */
ENTRY(reset)
MEMORY
{
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 128K
  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 20K
}
_estack = ORIGIN(RAM) + LENGTH(RAM);

SECTIONS
{
  .isr_vector : { KEEP(*(.isr_vector)) } > FLASH
  .text : { . = ALIGN(4); *(.text) *(.text*) *(.rodata) *(.rodata*) . = ALIGN(4); } > FLASH
  .cases : { . = ALIGN(4); __cases_start = .; KEEP(*(.cases)) __cases_end = .; } > FLASH
  .casestr : { KEEP(*(.casestr)) . = ALIGN(4); } > FLASH
  _sidata = LOADADDR(.data);
  .data : { . = ALIGN(4); _sdata = .; *(.data) *(.data*) . = ALIGN(4); _edata = .; } > RAM AT > FLASH
  .bss (NOLOAD) : { . = ALIGN(4); _sbss = .; *(.bss) *(.bss*) *(COMMON) . = ALIGN(4); _ebss = .; } > RAM
}
