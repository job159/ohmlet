/*
 * Minimal freestanding runtime for clang-built Cortex-M3 firmware (there is
 * no newlib / compiler-rt for bare-metal ARM in the LLVM-MinGW toolchain):
 * the mem* functions clang may emit calls to, their ARM EABI aliases, and
 * 64-bit division helpers. 32-bit division uses the M3's UDIV/SDIV.
 */
#include <stddef.h>
#include <stdint.h>

void *memcpy(void *dst, const void *src, size_t n) {
  uint8_t *d = dst;
  const uint8_t *s = src;
  while (n--) *d++ = *s++;
  return dst;
}

void *memmove(void *dst, const void *src, size_t n) {
  uint8_t *d = dst;
  const uint8_t *s = src;
  if (d < s) {
    while (n--) *d++ = *s++;
  } else {
    while (n--) d[n] = s[n];
  }
  return dst;
}

void *memset(void *dst, int c, size_t n) {
  uint8_t *d = dst;
  while (n--) *d++ = (uint8_t)c;
  return dst;
}

int memcmp(const void *a, const void *b, size_t n) {
  const uint8_t *x = a, *y = b;
  for (; n; n--, x++, y++)
    if (*x != *y) return *x - *y;
  return 0;
}

size_t strlen(const char *s) {
  size_t n = 0;
  while (s[n]) n++;
  return n;
}

void __aeabi_memcpy(void *d, const void *s, size_t n) { memcpy(d, s, n); }
void __aeabi_memcpy4(void *d, const void *s, size_t n) { memcpy(d, s, n); }
void __aeabi_memcpy8(void *d, const void *s, size_t n) { memcpy(d, s, n); }
void __aeabi_memmove(void *d, const void *s, size_t n) { memmove(d, s, n); }
void __aeabi_memmove4(void *d, const void *s, size_t n) { memmove(d, s, n); }
void __aeabi_memmove8(void *d, const void *s, size_t n) { memmove(d, s, n); }
/* NB: the EABI memset takes (dest, n, c) */
void __aeabi_memset(void *d, size_t n, int c) { memset(d, c, n); }
void __aeabi_memset4(void *d, size_t n, int c) { memset(d, c, n); }
void __aeabi_memset8(void *d, size_t n, int c) { memset(d, c, n); }
void __aeabi_memclr(void *d, size_t n) { memset(d, 0, n); }
void __aeabi_memclr4(void *d, size_t n) { memset(d, 0, n); }
void __aeabi_memclr8(void *d, size_t n) { memset(d, 0, n); }

/* shift-subtract 64-bit unsigned divide; d == 0 yields q = ~0, r = n */
uint64_t __ohmlet_udivmod64(uint64_t n, uint64_t d, uint64_t *rem) {
  if (d == 0) {
    *rem = n;
    return ~(uint64_t)0;
  }
  uint64_t q = 0, r = 0;
  for (int i = 63; i >= 0; i--) {
    r = (r << 1) | ((n >> i) & 1);
    if (r >= d) {
      r -= d;
      q |= (uint64_t)1 << i;
    }
  }
  *rem = r;
  return q;
}

int64_t __ohmlet_divmod64(int64_t n, int64_t d, int64_t *rem) {
  uint64_t un = n < 0 ? -(uint64_t)n : (uint64_t)n;
  uint64_t ud = d < 0 ? -(uint64_t)d : (uint64_t)d;
  uint64_t ur;
  uint64_t uq = __ohmlet_udivmod64(un, ud, &ur);
  *rem = n < 0 ? -(int64_t)ur : (int64_t)ur;
  return (n < 0) != (d < 0) ? -(int64_t)uq : (int64_t)uq;
}

/* AEABI: {quotient r1:r0, remainder r3:r2} = numerator r1:r0 / denominator r3:r2 */
__attribute__((naked)) void __aeabi_uldivmod(void) {
  __asm__ volatile(
      "push {r4, lr}\n"
      "sub sp, sp, #16\n"
      "add r4, sp, #8\n"
      "str r4, [sp]\n"
      "bl __ohmlet_udivmod64\n"
      "ldr r2, [sp, #8]\n"
      "ldr r3, [sp, #12]\n"
      "add sp, sp, #16\n"
      "pop {r4, pc}\n");
}

__attribute__((naked)) void __aeabi_ldivmod(void) {
  __asm__ volatile(
      "push {r4, lr}\n"
      "sub sp, sp, #16\n"
      "add r4, sp, #8\n"
      "str r4, [sp]\n"
      "bl __ohmlet_divmod64\n"
      "ldr r2, [sp, #8]\n"
      "ldr r3, [sp, #12]\n"
      "add sp, sp, #16\n"
      "pop {r4, pc}\n");
}
