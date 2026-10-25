/*
 * cpu-bench: the cpu-selftest workload (compiled -O2) repeated BENCH_ITER
 * times — a long, realistic instruction mix (loads/stores, branches, 64-bit
 * helpers, jump tables, calls) for measuring simulator throughput in MIPS.
 * Leaves a polynomial hash of all checksums in bench_result, then BKPT.
 */
#include <stdint.h>
#include "../cpu-selftest/selftest.h"

#ifndef BENCH_ITER
#define BENCH_ITER 60
#endif

volatile uint32_t bench_result;
volatile uint32_t bench_iterations = BENCH_ITER;
static char text[1024];

int main(void) {
  uint32_t acc = 0;
  for (uint32_t i = 0; i < bench_iterations; i++) acc = acc * 31u + selftest_run(text, sizeof text) + i;
  bench_result = acc;
  __asm volatile("bkpt #0x43");
  for (;;) {
  }
}
