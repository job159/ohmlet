#include "mini_printf.h"
#include <stdint.h>

typedef struct {
  char *buf;
  size_t size;
  size_t len;
  int to_putchar;
} sink_t;

static void emit(sink_t *s, char c) {
  if (s->to_putchar) mini_putchar(c);
  else if (s->len + 1 < s->size) s->buf[s->len] = c;
  s->len++;
}

static void emit_num(sink_t *s, uint64_t v, unsigned base, int upper, int neg, int width, int zero, int left) {
  char tmp[24];
  int n = 0;
  const char *digits = upper ? "0123456789ABCDEF" : "0123456789abcdef";
  do {
    tmp[n++] = digits[v % base];
    v /= base;
  } while (v);
  int len = n + (neg ? 1 : 0);
  if (!left && !zero)
    for (; width > len; width--) emit(s, ' ');
  if (neg) emit(s, '-');
  if (!left && zero)
    for (; width > len; width--) emit(s, '0');
  while (n) emit(s, tmp[--n]);
  if (left)
    for (; width > len; width--) emit(s, ' ');
}

static int format(sink_t *s, const char *fmt, va_list ap) {
  for (; *fmt; fmt++) {
    if (*fmt != '%') {
      emit(s, *fmt);
      continue;
    }
    fmt++;
    int left = 0, zero = 0, width = 0, prec = -1, lng = 0;
    for (;; fmt++) {
      if (*fmt == '-') left = 1;
      else if (*fmt == '0') zero = 1;
      else break;
    }
    while (*fmt >= '0' && *fmt <= '9') width = width * 10 + (*fmt++ - '0');
    if (*fmt == '.') {
      prec = 0;
      fmt++;
      while (*fmt >= '0' && *fmt <= '9') prec = prec * 10 + (*fmt++ - '0');
    }
    while (*fmt == 'l' || *fmt == 'z') {
      lng++;
      fmt++;
    }
    switch (*fmt) {
      case 'd':
      case 'i': {
        int64_t v = lng >= 2 ? va_arg(ap, long long) : lng == 1 ? va_arg(ap, long) : va_arg(ap, int);
        emit_num(s, v < 0 ? -(uint64_t)v : (uint64_t)v, 10, 0, v < 0, width, zero, left);
        break;
      }
      case 'u':
      case 'x':
      case 'X':
      case 'o': {
        uint64_t v = lng >= 2 ? va_arg(ap, unsigned long long)
                     : lng == 1 ? va_arg(ap, unsigned long)
                                : va_arg(ap, unsigned);
        unsigned base = *fmt == 'u' ? 10 : *fmt == 'o' ? 8 : 16;
        emit_num(s, v, base, *fmt == 'X', 0, width, zero, left);
        break;
      }
      case 'p':
        emit(s, '0');
        emit(s, 'x');
        emit_num(s, (uintptr_t)va_arg(ap, void *), 16, 0, 0, 8, 1, 0);
        break;
      case 'c':
        emit(s, (char)va_arg(ap, int));
        break;
      case 's': {
        const char *str = va_arg(ap, const char *);
        if (!str) str = "(null)";
        int n = 0;
        while (str[n] && (prec < 0 || n < prec)) n++;
        if (!left)
          for (; width > n; width--) emit(s, ' ');
        for (int i = 0; i < n; i++) emit(s, str[i]);
        if (left)
          for (; width > n; width--) emit(s, ' ');
        break;
      }
      case '%':
        emit(s, '%');
        break;
      case 0:
        return (int)s->len;
      default:
        emit(s, '%');
        emit(s, *fmt);
    }
  }
  return (int)s->len;
}

int mini_vsnprintf(char *buf, size_t size, const char *fmt, va_list ap) {
  sink_t s = {buf, size, 0, 0};
  int n = format(&s, fmt, ap);
  if (size) buf[s.len < size ? s.len : size - 1] = 0;
  return n;
}

int mini_snprintf(char *buf, size_t size, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  int n = mini_vsnprintf(buf, size, fmt, ap);
  va_end(ap);
  return n;
}

int mini_printf(const char *fmt, ...) {
  sink_t s = {0, 0, 0, 1};
  va_list ap;
  va_start(ap, fmt);
  int n = format(&s, fmt, ap);
  va_end(ap);
  return n;
}

void mini_puts(const char *str) {
  while (*str) mini_putchar(*str++);
}

/* default sink: discard (firmware overrides) */
__attribute__((weak)) void mini_putchar(char c) { (void)c; }
