/*
 * The pieces of newlib that ST's startup_stm32f103xb.s expects: it calls
 * __libc_init_array() before main(). Static constructors run from the
 * .preinit_array / .init_array tables the linker script collects.
 */
#include <stdint.h>

extern void (*__preinit_array_start[])(void) __attribute__((weak));
extern void (*__preinit_array_end[])(void) __attribute__((weak));
extern void (*__init_array_start[])(void) __attribute__((weak));
extern void (*__init_array_end[])(void) __attribute__((weak));

void __libc_init_array(void) {
  for (void (**f)(void) = __preinit_array_start; f < __preinit_array_end; f++) (*f)();
  for (void (**f)(void) = __init_array_start; f < __init_array_end; f++) (*f)();
}
