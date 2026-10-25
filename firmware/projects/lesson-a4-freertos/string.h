/*
 * Minimal <string.h> for the FreeRTOS kernel sources in this freestanding
 * build: the functions firmware/common/lib/runtime.c implements (queue.c,
 * tasks.c and stream_buffer.c use memcpy / memset).
 */
#ifndef LESSON_A4_STRING_H
#define LESSON_A4_STRING_H
#include <stddef.h>
void *memcpy(void *dst, const void *src, size_t n);
void *memmove(void *dst, const void *src, size_t n);
void *memset(void *dst, int c, size_t n);
int memcmp(const void *a, const void *b, size_t n);
size_t strlen(const char *s);
#endif
