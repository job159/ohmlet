/*
 * Minimal <stdlib.h> for the FreeRTOS kernel sources in this freestanding
 * build (no newlib: firmware/common/lib/runtime.c is the whole C runtime).
 * The kernel only needs NULL / size_t from it; heap_4.c is the allocator
 * (pvPortMalloc / vPortFree), malloc() and free() do not exist here.
 */
#ifndef LESSON_A4_STDLIB_H
#define LESSON_A4_STDLIB_H
#include <stddef.h>
#endif
