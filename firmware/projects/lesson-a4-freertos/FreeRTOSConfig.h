/*
 * FreeRTOSConfig.h — lesson-a4-freertos (FreeRTOS-Kernel V11.1.0, GCC/ARM_CM3
 * port, built with clang). STM32F103C8 Blue Pill at 72 MHz.
 *
 * Interrupt priorities (STM32F1: 4 implemented priority bits, NVIC group 4 =
 * all bits pre-emption, set by HAL_Init()):
 *   - SysTick and PendSV run at the LOWEST priority 15 (0xF0) — the kernel
 *     programs SHPR3 itself in xPortStartScheduler();
 *   - BASEPRI masks priorities 5..15 inside critical sections
 *     (configMAX_SYSCALL_INTERRUPT_PRIORITY = 5 << 4 = 0x50);
 *   - an ISR that calls a ...FromISR() API must have a priority value of 5 or
 *     MORE (numerically): EXTI15_10 uses 6. Priority 0..4 interrupts are never
 *     masked by the kernel and must not call the FreeRTOS API (configASSERT in
 *     vPortValidateInterruptPriority catches it — see the PB14 experiment).
 */
#ifndef FREERTOS_CONFIG_H
#define FREERTOS_CONFIG_H

#include <stdint.h>

extern uint32_t SystemCoreClock;
void vAssertCalled(const char *file, int line);
void vRunTimeCounterInit(void);
extern volatile uint32_t ulContextSwitches;
extern void *volatile pvLastSwitchedIn;

#define configUSE_PREEMPTION                    1
#define configUSE_PORT_OPTIMISED_TASK_SELECTION 1
#define configUSE_TICKLESS_IDLE                 0
#define configCPU_CLOCK_HZ                      (SystemCoreClock)
#define configTICK_RATE_HZ                      ((TickType_t)1000)
#define configMAX_PRIORITIES                    5
#define configMINIMAL_STACK_SIZE                ((uint16_t)128)
#define configTOTAL_HEAP_SIZE                   ((size_t)(8 * 1024))
#define configMAX_TASK_NAME_LEN                 8
#define configTICK_TYPE_WIDTH_IN_BITS           TICK_TYPE_WIDTH_32_BITS
#define configIDLE_SHOULD_YIELD                 1
#define configUSE_TIME_SLICING                  1
#define configUSE_MUTEXES                       1
#define configUSE_RECURSIVE_MUTEXES             0
#define configUSE_COUNTING_SEMAPHORES           0
#define configQUEUE_REGISTRY_SIZE               0
#define configUSE_QUEUE_SETS                    0
#define configUSE_TASK_NOTIFICATIONS            1
#define configENABLE_BACKWARD_COMPATIBILITY     0

/* memory */
#define configSUPPORT_DYNAMIC_ALLOCATION        1
#define configSUPPORT_STATIC_ALLOCATION         0

/* hooks */
#define configUSE_IDLE_HOOK                     1
#define configUSE_TICK_HOOK                     0
#define configCHECK_FOR_STACK_OVERFLOW          2
#define configUSE_MALLOC_FAILED_HOOK            1

/* run-time statistics: DWT->CYCCNT (72 MHz core cycles, wraps every 59.6 s;
   the lesson only uses differences over 1 s windows) */
#define configGENERATE_RUN_TIME_STATS           1
#define configRUN_TIME_COUNTER_TYPE             uint32_t
#define portCONFIGURE_TIMER_FOR_RUN_TIME_STATS() vRunTimeCounterInit()
#define portGET_RUN_TIME_COUNTER_VALUE()        (*(volatile uint32_t *)0xE0001004UL)
#define configUSE_TRACE_FACILITY                0
#define configUSE_STATS_FORMATTING_FUNCTIONS    0

/* software timers / co-routines: not used */
#define configUSE_TIMERS                        0
#define configUSE_CO_ROUTINES                   0

/* optional API */
#define INCLUDE_vTaskPrioritySet                0
#define INCLUDE_uxTaskPriorityGet               0
#define INCLUDE_vTaskDelete                     0
#define INCLUDE_vTaskSuspend                    1
#define INCLUDE_xTaskDelayUntil                 1
#define INCLUDE_vTaskDelay                      1
#define INCLUDE_xTaskGetSchedulerState          1
#define INCLUDE_uxTaskGetStackHighWaterMark     1
#define INCLUDE_xTaskGetIdleTaskHandle          1

/* Cortex-M3 interrupt priorities (see the header) */
#ifdef __NVIC_PRIO_BITS
#define configPRIO_BITS __NVIC_PRIO_BITS
#else
#define configPRIO_BITS 4
#endif
#define configLIBRARY_LOWEST_INTERRUPT_PRIORITY      15
#define configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY 5
#define configKERNEL_INTERRUPT_PRIORITY      (configLIBRARY_LOWEST_INTERRUPT_PRIORITY << (8 - configPRIO_BITS))
#define configMAX_SYSCALL_INTERRUPT_PRIORITY (configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY << (8 - configPRIO_BITS))

/* clang: __FILE_NAME__ is the basename (keeps build paths out of the image) */
#define configASSERT(x)                                                                                                \
  if ((x) == 0)                                                                                                        \
  vAssertCalled(__FILE_NAME__, __LINE__)

/* context-switch counter: traceTASK_SWITCHED_IN runs inside vTaskSwitchContext()
   (PendSV, interrupts masked to configMAX_SYSCALL_INTERRUPT_PRIORITY) every time
   the scheduler picks a task; only a CHANGE of the running task is counted */
#define traceTASK_SWITCHED_IN()                                                                                        \
  do {                                                                                                                 \
    if ((void *)pxCurrentTCB != pvLastSwitchedIn) {                                                                    \
      pvLastSwitchedIn = (void *)pxCurrentTCB;                                                                         \
      ulContextSwitches++;                                                                                             \
    }                                                                                                                  \
  } while (0)

/* the port's handlers ARE the vector-table entries of ST's startup file
   (CubeMX does the same); SysTick_Handler in stm32f1xx_it.c calls
   HAL_IncTick() and then xPortSysTickHandler() */
#define vPortSVCHandler    SVC_Handler
#define xPortPendSVHandler PendSV_Handler

#endif /* FREERTOS_CONFIG_H */
