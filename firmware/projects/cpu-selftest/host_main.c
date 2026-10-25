/*
 * Host (x86-64) reference build of cpu-selftest: compiled together with
 * selftest.c and firmware/common/lib/mini_printf.c by
 * tests/mcu/core/selftest.test.ts; prints the checksum line and the report.
 */
#include <stdio.h>
#include "selftest.h"

static char text[1024];

int main(void) {
  unsigned sum = selftest_run(text, sizeof text);
  printf("checksum %08x\n%s", sum, text);
  return 0;
}
