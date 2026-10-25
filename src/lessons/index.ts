/**
 * Lesson registry: every src/lessons/<level>/*.lesson.ts exporting
 * `LESSON: Lesson`, collected at build time and sorted by level then order.
 */
import type { Lesson, LessonLevel } from './types'

const modules = import.meta.glob<{ LESSON: Lesson }>('./*/*.lesson.ts', { eager: true })

const LEVEL_ORDER: Record<LessonLevel, number> = { beginner: 0, intermediate: 1, advanced: 2 }

export const LESSONS: Lesson[] = Object.values(modules)
  .map((m) => m.LESSON)
  .filter(Boolean)
  .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.order - b.order)

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id)
}

export type { Lesson, LessonLevel } from './types'
