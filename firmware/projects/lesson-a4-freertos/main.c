/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : lesson-a4-freertos — two periodic tasks, one queue, one
  *                   logger task and an interrupt, on FreeRTOS V11.1.0.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz × PLL9). FreeRTOS-Kernel V11.1.0, port
  * GCC/ARM_CM3, heap_4 (8 KiB), tick 1 kHz on SysTick (shared with the HAL
  * time base, see stm32f1xx_it.c). The context switch itself is the port's
  * PendSV handler; the first task is started by an SVC.
  *
  *   PA5   LED  push-pull, toggled by task "blink" (LED + 220 Ω to GND)
  *   PB12  BTN  input pull-up, EXTI12 falling edge (push-button to GND)
  *   PB13  experiment jumper (pull-up): tied to GND at reset → task "hog"
  *   PB14  experiment jumper (pull-up): tied to GND at reset → EXTI15_10 gets
  *         NVIC priority 2, ABOVE configMAX_SYSCALL_INTERRUPT_PRIORITY
  *   PA9/PA10  USART1 115200 8N1 — written ONLY by task "logger"
  *
  * Tasks (higher number = higher priority; idle = 0):
  *   fast   prio 3  every 100 ms (vTaskDelayUntil): sends {'F', seq, tick}
  *   blink  prio 2  every 250 ms (vTaskDelayUntil): toggles PA5, sends {'B', seq, level, tick}
  *   logger prio 1  blocks on the queue (8 × 8 bytes) and prints one line per
  *                  message; after every 4th 'B' message one statistics line
  *                  (context switches in the last second, idle time measured by
  *                  the kernel's run-time statistics on DWT->CYCCNT, queue peak,
  *                  stack high-water marks)
  *   EXTI15_10 ISR: a falling edge on PB12 (≥ 50 ms after the last accepted one)
  *                  sends {'K', seq, tick} with xQueueSendFromISR and requests a
  *                  context switch with portYIELD_FROM_ISR.
  *   hog    prio 4  (PB13 experiment only) waits 1 s, then busy-loops forever
  *                  without ever blocking: every lower-priority task starves.
  *
  * Only "logger" touches the UART (gatekeeper task): no mutex is needed and
  * lines can never interleave.
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include <stdarg.h>
#include "mini_printf.h"
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
/* USER CODE END Includes */

/* Private variables ---------------------------------------------------------*/
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
#define FAST_PRIO    3
#define BLINK_PRIO   2
#define LOGGER_PRIO  1
#define HOG_PRIO     4
#define FAST_MS      100
#define BLINK_MS     250
#define HOG_AFTER_MS 1000
#define QUEUE_LEN    8
#define STACK_WORDS  160

typedef struct
{
  char src;      /* 'F' fast, 'B' blink, 'K' button (ISR) */
  uint8_t level; /* 'B': the new LED level */
  uint16_t seq;  /* per-source sequence number, 1, 2, ... */
  uint32_t tick; /* xTaskGetTickCount() when the message was sent */
} msg_t;

static QueueHandle_t q;
static TaskHandle_t hFast, hBlink, hLogger;
static volatile uint32_t dropped;      /* queue full on send */
static volatile uint32_t btnLastTick;  /* tick of the last accepted button edge */
static volatile uint16_t btnSeq;
static volatile uint32_t hogLoops;
volatile uint32_t ulContextSwitches;   /* counted in traceTASK_SWITCHED_IN */
void *volatile pvLastSwitchedIn;
/* statistics window */
static uint32_t stCycles, stIdle, stSwitches;
static UBaseType_t qPeak;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void logf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void fast_task(void *arg);
static void blink_task(void *arg);
static void logger_task(void *arg);
static void hog_task(void *arg);
/* USER CODE END PFP */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  /* MCU Configuration--------------------------------------------------------*/
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_USART1_UART_Init();

  /* USER CODE BEGIN 2 */
  const int hog = HAL_GPIO_ReadPin(HOG_GPIO_Port, HOG_Pin) == GPIO_PIN_RESET;
  const int badPrio = HAL_GPIO_ReadPin(BADPRIO_GPIO_Port, BADPRIO_Pin) == GPIO_PIN_RESET;

  logf("FreeRTOS %s on STM32F103C8, %lu MHz, tick %u Hz\r\n", tskKERNEL_VERSION_NUMBER,
       (unsigned long)(SystemCoreClock / 1000000U), (unsigned)configTICK_RATE_HZ);

  /* From the first kernel object on, interrupts up to configMAX_SYSCALL_
     INTERRUPT_PRIORITY stay masked (BASEPRI) until the scheduler starts the
     first task: the kernel's critical-section nesting count starts non-zero. */
  q = xQueueCreate(QUEUE_LEN, sizeof(msg_t));
  if (q == NULL
      || xTaskCreate(fast_task, "fast", STACK_WORDS, NULL, FAST_PRIO, &hFast) != pdPASS
      || xTaskCreate(blink_task, "blink", STACK_WORDS, NULL, BLINK_PRIO, &hBlink) != pdPASS
      || xTaskCreate(logger_task, "logger", 2 * STACK_WORDS, NULL, LOGGER_PRIO, &hLogger) != pdPASS
      || (hog && xTaskCreate(hog_task, "hog", configMINIMAL_STACK_SIZE, NULL, HOG_PRIO, NULL) != pdPASS))
  {
    logf("out of heap\r\n");
    Error_Handler();
  }
  logf("tasks: fast prio %d every %d ms, blink prio %d every %d ms, logger prio %d; queue %d x %u B\r\n",
       FAST_PRIO, FAST_MS, BLINK_PRIO, BLINK_MS, LOGGER_PRIO, QUEUE_LEN, (unsigned)sizeof(msg_t));
  if (hog)
  {
    logf("PB13 low: task hog prio %d busy-loops from %d ms on\r\n", HOG_PRIO, HOG_AFTER_MS);
  }
  if (badPrio)
  {
    logf("PB14 low: EXTI15_10 at NVIC priority %u (above the syscall limit %d)\r\n",
         BTN_IRQ_PRIORITY_BAD, configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY);
  }

  /* the button interrupt: legal priority 6, or 2 for the PB14 experiment */
  HAL_NVIC_SetPriority(BTN_EXTI_IRQn, badPrio ? BTN_IRQ_PRIORITY_BAD : BTN_IRQ_PRIORITY, 0);
  __HAL_GPIO_EXTI_CLEAR_IT(BTN_Pin);
  HAL_NVIC_EnableIRQ(BTN_EXTI_IRQn);

  logf("heap free %u B, starting the scheduler\r\n", (unsigned)xPortGetFreeHeapSize());
  /* The HAL's SysTick kept counting while BASEPRI masked it, so a SysTick
     exception is PENDING now (ICSR.PENDSTSET). The port reprograms SysTick
     but does not clear that pending bit: without this line the first task
     would see tick 1 at once and every period would start 1 ms early. */
  SCB->ICSR = SCB_ICSR_PENDSTCLR_Msk;
  vTaskStartScheduler();
  /* USER CODE END 2 */

  /* only reached when the idle task could not be created */
  logf("vTaskStartScheduler returned\r\n");
  Error_Handler();
  return 0;
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState = RCC_HSE_ON;
  RCC_OscInitStruct.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLMUL = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief USART1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_USART1_UART_Init(void)
{
  huart1.Instance = USART1;
  huart1.Init.BaudRate = 115200;
  huart1.Init.WordLength = UART_WORDLENGTH_8B;
  huart1.Init.StopBits = UART_STOPBITS_1;
  huart1.Init.Parity = UART_PARITY_NONE;
  huart1.Init.Mode = UART_MODE_TX_RX;
  huart1.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart1.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart1) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief GPIO Initialization Function
  * @param None
  * @retval None
  */
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};

  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pin : LED_Pin */
  GPIO_InitStruct.Pin = LED_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(LED_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : BTN_Pin (EXTI12 falling; the NVIC is set up in main) */
  GPIO_InitStruct.Pin = BTN_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_FALLING;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(BTN_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pins : HOG_Pin BADPRIO_Pin (experiment jumpers) */
  GPIO_InitStruct.Pin = HOG_Pin|BADPRIO_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}

/* USER CODE BEGIN 4 */

/* ------------------------------------------------------------------ tasks */

static void fast_task(void *arg)
{
  (void)arg;
  msg_t m = {'F', 0, 0, 0};
  TickType_t last = xTaskGetTickCount();
  for (;;)
  {
    vTaskDelayUntil(&last, pdMS_TO_TICKS(FAST_MS));
    m.seq++;
    m.tick = xTaskGetTickCount();
    /* the logger has the LOWER priority: no context switch happens here, the
       message waits in the queue until this task (and blink) block again */
    if (xQueueSend(q, &m, 0) != pdPASS)
    {
      dropped++;
    }
  }
}

static void blink_task(void *arg)
{
  (void)arg;
  msg_t m = {'B', 0, 0, 0};
  TickType_t last = xTaskGetTickCount();
  for (;;)
  {
    vTaskDelayUntil(&last, pdMS_TO_TICKS(BLINK_MS));
    m.level ^= 1U;
    HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, m.level ? GPIO_PIN_SET : GPIO_PIN_RESET);
    m.seq++;
    m.tick = xTaskGetTickCount();
    if (xQueueSend(q, &m, 0) != pdPASS)
    {
      dropped++;
    }
  }
}

static void print_stats(uint32_t tick)
{
  const uint32_t cycles = portGET_RUN_TIME_COUNTER_VALUE();
  const uint32_t idle = ulTaskGetIdleRunTimeCounter();
  const uint32_t dCycles = cycles - stCycles;
  const uint32_t dIdle = idle - stIdle;
  const uint32_t switches = ulContextSwitches;
  const uint32_t permille = dCycles ? (uint32_t)(((uint64_t)dIdle * 1000U + dCycles / 2U) / dCycles) : 0U;
  logf("[%6lu] stats: %lu context switches, idle %lu.%lu%%, queue peak %u/%d, stack free fast %u blink %u logger %u words\r\n",
       (unsigned long)tick, (unsigned long)(switches - stSwitches), (unsigned long)(permille / 10U),
       (unsigned long)(permille % 10U), (unsigned)qPeak, QUEUE_LEN,
       (unsigned)uxTaskGetStackHighWaterMark(hFast), (unsigned)uxTaskGetStackHighWaterMark(hBlink),
       (unsigned)uxTaskGetStackHighWaterMark(hLogger));
  stCycles = cycles;
  stIdle = idle;
  stSwitches = switches;
  qPeak = 0;
}

static void logger_task(void *arg)
{
  (void)arg;
  msg_t m;
  /* statistics window starts with the first task */
  stCycles = portGET_RUN_TIME_COUNTER_VALUE();
  stIdle = ulTaskGetIdleRunTimeCounter();
  stSwitches = ulContextSwitches;
  for (;;)
  {
    (void)xQueueReceive(q, &m, portMAX_DELAY);
    const UBaseType_t waiting = uxQueueMessagesWaiting(q) + 1U;
    if (waiting > qPeak)
    {
      qPeak = waiting;
    }
    switch (m.src)
    {
      case 'F':
        logf("[%6lu] fast  #%u\r\n", (unsigned long)m.tick, (unsigned)m.seq);
        break;
      case 'B':
        logf("[%6lu] blink #%u LED %s\r\n", (unsigned long)m.tick, (unsigned)m.seq, m.level ? "on" : "off");
        if (m.seq % 4U == 0U)
        {
          print_stats(m.tick); /* every 4th blink message = every second */
        }
        break;
      case 'K':
        logf("[%6lu] button #%u (EXTI ISR -> queue)\r\n", (unsigned long)m.tick, (unsigned)m.seq);
        break;
      default:
        break;
    }
    if (dropped)
    {
      logf("queue full: %lu message(s) dropped\r\n", (unsigned long)dropped);
      dropped = 0;
    }
  }
}

static void hog_task(void *arg)
{
  (void)arg;
  vTaskDelay(pdMS_TO_TICKS(HOG_AFTER_MS));
  for (;;)
  {
    /* never blocks: the scheduler always picks this READY task of the highest
       priority — fast, blink, logger and idle never run again (SysTick still
       counts, interrupts still run) */
    hogLoops++;
  }
}

/* ----------------------------------------------------------- interrupt */

/* EXTI12 (HAL_GPIO_EXTI_IRQHandler cleared EXTI_PR). Runs at NVIC priority 6:
   allowed to call the FromISR API. With the PB14 experiment it runs at 2 and
   the kernel's vPortValidateInterruptPriority() assertion fires. */
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)
{
  if (GPIO_Pin != BTN_Pin)
  {
    return;
  }
  const TickType_t now = xTaskGetTickCountFromISR();
  if (btnSeq != 0U && (now - btnLastTick) < pdMS_TO_TICKS(BTN_LOCKOUT_MS))
  {
    return; /* contact bounce */
  }
  btnLastTick = now;
  btnSeq++;
  msg_t m = {'K', 0, btnSeq, now};
  BaseType_t woken = pdFALSE;
  if (xQueueSendFromISR(q, &m, &woken) != pdPASS)
  {
    dropped++;
  }
  /* woken is pdTRUE when a task of higher priority than the interrupted one
     became ready: PendSV then switches to it as the ISR returns */
  portYIELD_FROM_ISR(woken);
}

/* ------------------------------------------------------------ kernel hooks */

void vApplicationIdleHook(void)
{
  /* nothing: the idle task spins, so DWT->CYCCNT (which stops in sleep mode on
     silicon) counts the idle time correctly */
}

void vApplicationMallocFailedHook(void)
{
  vAssertCalled("malloc", 0);
}

void vApplicationStackOverflowHook(TaskHandle_t xTask, char *pcTaskName)
{
  (void)xTask;
  vAssertCalled(pcTaskName, -1);
}

void vRunTimeCounterInit(void)
{
  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0;
  DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

/* configASSERT / hook failure: report on USART1 by polling the registers
   (no HAL, no kernel), then stop with interrupts disabled */
static void raw_putc(char c)
{
  while ((USART1->SR & USART_SR_TXE) == 0U)
  {
  }
  USART1->DR = (uint8_t)c;
}

static void raw_puts(const char *s)
{
  while (*s)
  {
    raw_putc(*s++);
  }
}

void vAssertCalled(const char *file, int line)
{
  char num[12];
  __disable_irq();
  if (line == -1)
  {
    raw_puts("STACK OVERFLOW in task ");
    raw_puts(file);
  }
  else if (line == 0)
  {
    raw_puts("pvPortMalloc failed (heap exhausted)");
  }
  else
  {
    mini_snprintf(num, sizeof num, "%d", line);
    raw_puts("configASSERT failed: ");
    raw_puts(file);
    raw_puts(":");
    raw_puts(num);
  }
  raw_puts("\r\n");
  while ((USART1->SR & USART_SR_TC) == 0U)
  {
  }
  for (;;)
  {
  }
}

/* formatted line on USART1 (blocking, 86.8 µs per byte); only the logger task
   and main() before vTaskStartScheduler() call it */
static void logf(const char *fmt, ...)
{
  char buf[136];
  va_list ap;
  va_start(ap, fmt);
  int n = mini_vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  if (n > (int)sizeof buf - 1)
  {
    n = (int)sizeof buf - 1;
  }
  HAL_UART_Transmit(&huart1, (const uint8_t *)buf, (uint16_t)n, 100);
}

/* USER CODE END 4 */

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  __disable_irq();
  while (1)
  {
  }
}

#ifdef  USE_FULL_ASSERT
void assert_failed(uint8_t *file, uint32_t line)
{
  (void)file;
  (void)line;
}
#endif /* USE_FULL_ASSERT */
