/* cpu-selftest: shared between the Cortex-M3 build and the host reference build */
#ifndef SELFTEST_H
#define SELFTEST_H
#include <stddef.h>
#include <stdint.h>

/* runs every test, writes the report text into out[size] (NUL-terminated) and returns the checksum */
uint32_t selftest_run(char *out, size_t size);

#endif
