/*
 * Small printf for firmware without newlib. Supports %d %i %u %x %X %o %c %s
 * %p %%, the l / ll / z length modifiers, field width, the zero and minus
 * flags and precision for strings. No floating point (keeps soft-float out of
 * the image). Output goes to mini_putchar(), which the firmware defines
 * (UART, ITM, ...).
 */
#ifndef MINI_PRINTF_H
#define MINI_PRINTF_H
#include <stdarg.h>
#include <stddef.h>

void mini_putchar(char c);
int mini_printf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
int mini_snprintf(char *buf, size_t size, const char *fmt, ...) __attribute__((format(printf, 3, 4)));
int mini_vsnprintf(char *buf, size_t size, const char *fmt, va_list ap);
void mini_puts(const char *s);

#endif
