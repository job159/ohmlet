/*
 * cpu-selftest — portable C exercising the code paths a compiler generates
 * for Cortex-M3: table-driven CRC32, recursive/iterative sorting, 64-bit
 * multiply/divide (__aeabi_uldivmod/__aeabi_ldivmod on the target), bit
 * manipulation (CLZ/RBIT/REV/BFI/UBFX/SBFX), dense switch statements (TBB/TBH
 * jump tables), struct copies (LDM/STM/LDRD/STRD), recursion and varargs
 * (mini_snprintf).
 *
 * The SAME file is compiled for the host (x86-64, clang -O2) by
 * tests/mcu/core/selftest.test.ts and for the Cortex-M3 (-O0/-Os/-O2) by
 * firmware/build.mjs; the simulated run must print byte-identical text and
 * the same checksum. Only fixed-width types are used (no `long`, no plain
 * `char` arithmetic — char signedness differs between the two ABIs) and no
 * signed overflow is relied upon.
 */
#include <stddef.h>
#include <stdint.h>
#include "mini_printf.h"
#include "selftest.h"

/* -------------------------------------------------------------- checksum */

static uint32_t crc_table[256];

static void crc_init(void) {
  for (uint32_t i = 0; i < 256; i++) {
    uint32_t c = i;
    for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
    crc_table[i] = c;
  }
}

static uint32_t crc32_update(uint32_t crc, const uint8_t *p, size_t n) {
  crc = ~crc;
  while (n--) crc = crc_table[(crc ^ *p++) & 0xff] ^ (crc >> 8);
  return ~crc;
}

static uint32_t g_sum;

static void mix(uint32_t v) {
  uint8_t b[4] = {(uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24)};
  g_sum = crc32_update(g_sum, b, 4);
}

static void mix64(uint64_t v) {
  mix((uint32_t)v);
  mix((uint32_t)(v >> 32));
}

static uint32_t rng_state;

static uint32_t xorshift32(void) {
  uint32_t x = rng_state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return rng_state = x;
}

/* ---------------------------------------------------------------- sorting */

static void quicksort(int32_t *a, int lo, int hi) {
  while (lo < hi) {
    int32_t pivot = a[lo + (hi - lo) / 2];
    int i = lo, j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        int32_t t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    /* recurse into the smaller half, loop on the larger one */
    if (j - lo < hi - i) {
      quicksort(a, lo, j);
      lo = i;
    } else {
      quicksort(a, i, hi);
      hi = j;
    }
  }
}

static void insertion_sort_u16(uint16_t *a, int n) {
  for (int i = 1; i < n; i++) {
    uint16_t v = a[i];
    int j = i - 1;
    while (j >= 0 && a[j] > v) {
      a[j + 1] = a[j];
      j--;
    }
    a[j + 1] = v;
  }
}

/* ----------------------------------------------------------------- 64-bit */

static uint64_t udiv64_loop(uint32_t seed, uint32_t *ok) {
  uint64_t acc = 0;
  rng_state = seed;
  for (int i = 0; i < 64; i++) {
    uint64_t a = ((uint64_t)xorshift32() << 32) | xorshift32();
    uint64_t b = ((uint64_t)xorshift32() >> (i & 31)) + 1;
    if (i & 1) b = (b << 32) | xorshift32();
    uint64_t q = a / b, r = a % b;
    if (q * b + r != a || r >= b) *ok = 0;
    acc ^= q * 0x9E3779B97F4A7C15ull + r;
    int64_t sa = (int64_t)a, sb = (int64_t)(b | 1) * ((i & 2) ? -1 : 1);
    int64_t sq = sa / sb, sr = sa % sb;
    acc += (uint64_t)sq ^ ((uint64_t)sr << 1);
    acc = (acc << (i % 61)) | (acc >> (64 - (i % 61) - 1) >> 1); /* variable 64-bit shifts */
  }
  return acc;
}

static uint64_t mul64_mix(uint32_t x, uint32_t y) {
  uint64_t p = (uint64_t)x * y;                 /* UMULL */
  int64_t s = (int64_t)(int32_t)x * (int32_t)y; /* SMULL */
  uint64_t acc = p + (uint64_t)s;
  acc += (uint64_t)x * 0xFFFFFFFFu + y;         /* UMLAL */
  return acc;
}

/* ------------------------------------------------------- bit manipulation */

struct bits {
  uint32_t lo : 5;
  uint32_t mid : 11;
  int32_t sgn : 7;
  uint32_t top : 9;
};

static uint32_t popcount32(uint32_t x) {
  uint32_t n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

static uint32_t bit_tests(uint32_t seed) {
  uint32_t acc = 0;
  rng_state = seed;
  for (int i = 0; i < 100; i++) {
    uint32_t v = xorshift32();
    acc += (uint32_t)__builtin_clz(v | 1);
    acc ^= __builtin_bswap32(v);
    acc += __builtin_bitreverse32(v) >> 7;
    acc += popcount32(v);
    acc ^= (v >> (i & 31)) | (v << ((32 - (i & 31)) & 31));
    struct bits b;
    b.lo = v;
    b.mid = v >> 5;
    b.sgn = (int32_t)(int8_t)(uint8_t)(v >> 16) >> 1;
    b.top = v >> 23;
    acc += b.lo + b.mid * 3u + (uint32_t)b.sgn + b.top;
    int16_t h = (int16_t)(uint16_t)v;
    acc += (uint32_t)(int32_t)h;
    acc += (uint32_t)((int32_t)v >> 7) & 0x3fff;
    int32_t clamp = (int32_t)v >> 20;
    if (clamp > 127) clamp = 127;
    if (clamp < -128) clamp = -128;
    acc += (uint32_t)clamp;
  }
  return acc;
}

/* ----------------------------------------------------- dense switch tables */

static uint32_t sw_small(uint32_t op, uint32_t a, uint32_t b) {
  switch (op) {
    case 0: return a + b;
    case 1: return a - b;
    case 2: return a * b;
    case 3: return a ^ b;
    case 4: return a | b;
    case 5: return a & b;
    case 6: return a << (b & 31);
    case 7: return a >> (b & 31);
    case 8: return b ? a / b : 0xffffffffu;
    case 9: return b ? a % b : 0xfffffffeu;
    case 10: return ~a;
    case 11: return a + 1;
    case 12: return b - a;
    case 13: return a * 3 + b;
    case 14: return (a & 0xff) | (b & 0xff00);
    case 15: return a > b ? a : b;
    case 16: return a < b ? a : b;
    case 17: return (uint32_t)((int32_t)a >> (b & 31));
    default: return 0x5a5a5a5au;
  }
}

static uint32_t sw_large(uint32_t k) {
  /* many sparse-free cases spread over > 256 halfwords of code → TBH */
  switch (k) {
#define C(n) \
  case n: return (uint32_t)(n * 2654435761u) ^ (k << 3) ^ ((k * 7u) >> 1);
    C(0) C(1) C(2) C(3) C(4) C(5) C(6) C(7) C(8) C(9) C(10) C(11) C(12) C(13) C(14) C(15)
    C(16) C(17) C(18) C(19) C(20) C(21) C(22) C(23) C(24) C(25) C(26) C(27) C(28) C(29) C(30) C(31)
    C(32) C(33) C(34) C(35) C(36) C(37) C(38) C(39) C(40) C(41) C(42) C(43) C(44) C(45) C(46) C(47)
    C(48) C(49) C(50) C(51) C(52) C(53) C(54) C(55) C(56) C(57) C(58) C(59) C(60) C(61) C(62) C(63)
#undef C
    default: return k;
  }
}

/* ----------------------------------------------------------- struct copies */

struct rec {
  uint32_t id;
  uint16_t kind;
  uint8_t flags[6];
  uint64_t big;
  int32_t vals[5];
};

static struct rec make_rec(uint32_t i) {
  struct rec r;
  r.id = i * 17u;
  r.kind = (uint16_t)(i ^ 0x5a5a);
  for (int k = 0; k < 6; k++) r.flags[k] = (uint8_t)(i + k * 31);
  r.big = ((uint64_t)i << 40) | (i * 0x01010101u);
  for (int k = 0; k < 5; k++) r.vals[k] = (int32_t)(i * 7u) - k * 1000;
  return r;
}

static uint32_t struct_tests(void) {
  struct rec arr[12];
  for (int i = 0; i < 12; i++) arr[i] = make_rec((uint32_t)i + 3);
  struct rec tmp = arr[0];
  for (int i = 0; i < 11; i++) arr[i] = arr[i + 1];
  arr[11] = tmp;
  uint32_t acc = 0;
  for (int i = 0; i < 12; i++) {
    acc = crc32_update(acc, (const uint8_t *)&arr[i].id, 4);
    acc += arr[i].kind + arr[i].flags[i % 6] + (uint32_t)arr[i].big + (uint32_t)(arr[i].big >> 32);
    for (int k = 0; k < 5; k++) acc += (uint32_t)arr[i].vals[k];
  }
  return acc;
}

/* --------------------------------------------------------------- recursion */

static uint32_t fib(uint32_t n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

static uint32_t ackermann(uint32_t m, uint32_t n) {
  if (m == 0) return n + 1;
  if (n == 0) return ackermann(m - 1, 1);
  return ackermann(m - 1, ackermann(m, n - 1));
}

static uint32_t hanoi(int n, int from, int to, int via, uint32_t *moves) {
  if (n == 0) return 0;
  hanoi(n - 1, from, via, to, moves);
  *moves = *moves * 3u + (uint32_t)(from * 4 + to);
  hanoi(n - 1, via, to, from, moves);
  return *moves;
}

/* ------------------------------------------------------------------ driver */

static int32_t arr32[200];
static uint16_t arr16[120];

uint32_t selftest_run(char *out, size_t size) {
  size_t len = 0;
#define OUT(...) len += (size_t)mini_snprintf(out + len, len < size ? size - len : 0, __VA_ARGS__)
  crc_init();
  g_sum = 0;

  /* CRC32 of a known string and of a generated buffer */
  const char *msg = "The quick brown fox jumps over the lazy dog";
  size_t mlen = 0;
  while (msg[mlen]) mlen++;
  uint32_t c1 = crc32_update(0, (const uint8_t *)msg, mlen);
  uint8_t buf[256];
  for (int i = 0; i < 256; i++) buf[i] = (uint8_t)(i * 7 + 3);
  uint32_t c2 = crc32_update(0, buf, sizeof buf);
  mix(c1);
  mix(c2);
  OUT("crc %08x %08x\n", c1, c2);

  /* sorting */
  rng_state = 0x12345678u;
  for (int i = 0; i < 200; i++) arr32[i] = (int32_t)(xorshift32() >> 1) - 0x20000000;
  quicksort(arr32, 0, 199);
  int sorted = 1;
  for (int i = 1; i < 200; i++) sorted &= arr32[i - 1] <= arr32[i];
  for (int i = 0; i < 120; i++) arr16[i] = (uint16_t)xorshift32();
  insertion_sort_u16(arr16, 120);
  for (int i = 1; i < 120; i++) sorted &= arr16[i - 1] <= arr16[i];
  for (int i = 0; i < 200; i += 17) mix((uint32_t)arr32[i]);
  for (int i = 0; i < 120; i += 13) mix(arr16[i]);
  OUT("sort %d min %d max %d med %u\n", sorted, (int)arr32[0], (int)arr32[199], (unsigned)arr16[60]);

  /* 64-bit arithmetic */
  uint32_t ok = 1;
  uint64_t d = udiv64_loop(0xdeadbeefu, &ok);
  uint64_t m1 = mul64_mix(0x89abcdefu, 0xfedcba98u);
  uint64_t m2 = mul64_mix(0x7fffffffu, 0x80000001u);
  mix64(d);
  mix64(m1);
  mix64(m2);
  OUT("div64 ok=%u %016llx\nmul64 %016llx %016llx\n", (unsigned)ok, (unsigned long long)d, (unsigned long long)m1,
      (unsigned long long)m2);
  int64_t neg = -1234567890123ll;
  OUT("fmt64 %lld %llu %llx\n", (long long)neg, (unsigned long long)(neg / 7), (unsigned long long)(uint64_t)(neg % 1000));

  /* 32-bit division (SDIV/UDIV) incl. negative operands */
  uint32_t dv = 0;
  for (int32_t a = -50000; a < 50000; a += 777) {
    for (int32_t b = -9; b <= 9; b += 3) {
      if (b == 0) continue;
      dv = dv * 31u + (uint32_t)(a / b) + (uint32_t)(a % b);
      dv ^= ((uint32_t)a / (uint32_t)(b + 10)) + ((uint32_t)a % (uint32_t)(b + 10));
    }
  }
  mix(dv);
  OUT("div32 %08x\n", dv);

  /* bit manipulation */
  uint32_t bt = bit_tests(0xcafebabeu);
  mix(bt);
  OUT("bits %08x\n", bt);

  /* switch tables */
  uint32_t sw = 0;
  rng_state = 777;
  for (int i = 0; i < 300; i++) {
    uint32_t r = xorshift32();
    sw = sw * 33u + sw_small(r % 20u, r >> 7, r >> 19);
    sw ^= sw_large((r >> 3) % 70u);
  }
  mix(sw);
  OUT("switch %08x\n", sw);

  /* structs */
  uint32_t st = struct_tests();
  mix(st);
  OUT("struct %08x\n", st);

  /* recursion */
  uint32_t moves = 0;
  uint32_t f = fib(20);
  uint32_t ak = ackermann(2, 3);
  uint32_t hn = hanoi(10, 1, 3, 2, &moves);
  mix(f);
  mix(ak);
  mix(hn);
  OUT("recur fib20=%u ack23=%u hanoi=%08x\n", (unsigned)f, (unsigned)ak, hn);

  /* varargs formatting */
  OUT("fmt [%5d] [%-5d] [%05u] [%x] [%X] [%o] [%c] [%.3s] [%8s] [%%]\n", -42, 42, 42u, 0xbeefu, 0xbeefu, 8u, 'Z', "abcdef", "hi");

  mix((uint32_t)len);
  OUT("sum %08x\n", g_sum);
  return g_sum;
#undef OUT
}
