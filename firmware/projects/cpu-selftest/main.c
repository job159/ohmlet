/*
 * cpu-selftest target entry: runs selftest_run() (selftest.c), leaves the
 * checksum and report text in RAM for the simulator test to read, then
 * halts on BKPT (the simulated core halts like a debugger-attached part).
 */
#include <stdint.h>
#include "selftest.h"

volatile uint32_t selftest_checksum;
volatile uint32_t selftest_done;
char selftest_text[1024];

int main(void) {
  selftest_checksum = selftest_run(selftest_text, sizeof selftest_text);
  selftest_done = 0x600DF00Du;
  __asm volatile("bkpt #0x42");
  for (;;) {
  }
}
