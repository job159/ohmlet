/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : lesson-a3-uart-dma — USART1 reception by circular DMA +
  *                   IDLE line detection; USART2 plays the external device.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  *
  *   PA2   USART2_TX  the "sensor": sends a test message by DMA1 channel 7
  *                    every 200 ms (wire PA2 -> PA10 on the breadboard)
  *   PA10  USART1_RX  DMA1 channel 5, CIRCULAR, into rx_ring[32], with
  *                    HAL_UARTEx_ReceiveToIdle_DMA (HT / TC / IDLE events)
  *   PA9   USART1_TX  the report, 115200 8N1 (blocking, mini_printf)
  *   PB12  jumper: tied to GND at reset -> RX DMA in NORMAL mode and never
  *         re-armed: only the first message is received (the classic bug)
  *   PB13  jumper: tied to GND at reset -> RX by interrupt, RXNE for every
  *         byte (HAL_UARTEx_ReceiveToIdle_IT), for comparison
  *   PB0   output: high while the CPU is inside USART1_IRQHandler or
  *         DMA1_Channel5_IRQHandler — the CPU time reception costs, visible
  *         on a logic analyzer next to PA10
  *
  * The test messages, in turn: "hello" (5 B), "T=23.5C H=45% P=1013hPa"
  * (23 B), "0123456789abcdefghijklmnopqrstuvwxyzABCD" (40 B). The reception
  * events of one message (HT at ring position 16, TC at 32 = wrap, IDLE one
  * frame after the last byte) are collected in the ISR; at IDLE the message
  * is complete and the main loop prints
  *   "msg #<n>: <len> B [<events>] irq=<k> isr=<us> us: <text>\r\n"
  * k = USART1 + DMA1 channel 5 interrupts the message caused, isr = the
  * core cycles spent in those two handlers (DWT->CYCCNT) / 72.
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "mini_printf.h"
/* USER CODE END Includes */

/* Private variables ---------------------------------------------------------*/
UART_HandleTypeDef huart1;
UART_HandleTypeDef huart2;
DMA_HandleTypeDef hdma_usart1_rx;
DMA_HandleTypeDef hdma_usart2_tx;

/* USER CODE BEGIN PV */
RxMode rx_mode = RX_DMA_CIRCULAR;
volatile uint32_t rx_irqs;
volatile uint32_t rx_cycles;

typedef struct
{
  uint8_t len;
  char events[24]; /* "tc ht tc idle" */
  char text[MSG_MAX + 1];
} Msg;

static uint8_t rx_ring[RX_RING_SIZE];  /* DMA1 channel 5 writes here */
static uint8_t it_buf[MSG_MAX];        /* interrupt mode buffer */
static uint32_t rx_pos;                /* ring position consumed so far (ISR) */
static Msg cur;                        /* message being assembled (ISR) */
static Msg msgq[MSG_QUEUE_DEPTH];
static volatile uint32_t q_head;       /* ISR */
static volatile uint32_t q_tail;       /* main loop */

static const char *const PEER_MSG[] = {
  "hello",
  "T=23.5C H=45% P=1013hPa",
  "0123456789abcdefghijklmnopqrstuvwxyzABCD",
};
static const uint16_t PEER_LEN[] = {5U, 23U, 40U};
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_DMA_Init(void);
static void MX_USART1_UART_Init(void);
static void MX_USART2_UART_Init(void);
/* USER CODE BEGIN PFP */
static void start_reception(void);
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

  MX_GPIO_Init(); /* reads the experiment jumpers: rx_mode */
  MX_DMA_Init();
  MX_USART1_UART_Init();
  MX_USART2_UART_Init();
  /* USER CODE BEGIN 2 */
  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0;
  DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;

  mini_printf("UART DMA lesson a3: USART2 TX (PA2) -> USART1 RX (PA10), 115200 8N1\r\n");
  if (rx_mode == RX_DMA_NORMAL_ONCE)
  {
    mini_printf("PB12 low: RX DMA in NORMAL mode, not re-armed after the first message\r\n");
  }
  else if (rx_mode == RX_INTERRUPT)
  {
    mini_printf("PB13 low: RX by interrupt, RXNE for every byte + IDLE\r\n");
  }
  else
  {
    mini_printf("RX: DMA1 ch5 circular, 32 B ring + IDLE line detection\r\n");
  }
  start_reception();

  uint32_t peer_next = HAL_GetTick() + PEER_FIRST_MS;
  uint32_t peer_k = 0;
  uint32_t shown = 0;
  uint32_t irq_mark = 0;
  uint32_t cyc_mark = 0;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    /* the external device: one message every 200 ms, by DMA (no CPU work while it is on the wire) */
    if ((int32_t)(HAL_GetTick() - peer_next) >= 0 && huart2.gState == HAL_UART_STATE_READY)
    {
      const uint32_t k = peer_k % 3U;
      if (HAL_UART_Transmit_DMA(&huart2, (const uint8_t *)PEER_MSG[k], PEER_LEN[k]) != HAL_OK)
      {
        Error_Handler();
      }
      peer_k++;
      peer_next += PEER_PERIOD_MS;
    }
    if (q_tail != q_head)
    {
      const Msg *m = &msgq[q_tail % MSG_QUEUE_DEPTH];
      __disable_irq();
      const uint32_t irqs = rx_irqs;
      const uint32_t cyc = rx_cycles;
      __enable_irq();
      const uint32_t tenths = ((cyc - cyc_mark) * 10U + 36U) / 72U; /* 0.1 us */
      shown++;
      mini_printf("msg #%lu: %u B [%s] irq=%lu isr=%lu.%lu us: %s\r\n", (unsigned long)shown, (unsigned)m->len,
                  m->events, (unsigned long)(irqs - irq_mark), (unsigned long)(tenths / 10U),
                  (unsigned long)(tenths % 10U), m->text);
      irq_mark = irqs;
      cyc_mark = cyc;
      q_tail++;
    }
    else
    {
      __WFI(); /* nothing to do: sleep until the next interrupt (SysTick, DMA, USART) */
    }
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
  }
  /* USER CODE END 3 */
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
  * @brief USART2 Initialization Function (TX only: the simulated external device)
  * @param None
  * @retval None
  */
static void MX_USART2_UART_Init(void)
{
  huart2.Instance = USART2;
  huart2.Init.BaudRate = 115200;
  huart2.Init.WordLength = UART_WORDLENGTH_8B;
  huart2.Init.StopBits = UART_STOPBITS_1;
  huart2.Init.Parity = UART_PARITY_NONE;
  huart2.Init.Mode = UART_MODE_TX;
  huart2.Init.HwFlowCtl = UART_HWCONTROL_NONE;
  huart2.Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(&huart2) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * Enable DMA controller clock
  */
static void MX_DMA_Init(void)
{
  __HAL_RCC_DMA1_CLK_ENABLE();

  /* DMA1_Channel5_IRQn (USART1_RX) */
  HAL_NVIC_SetPriority(DMA1_Channel5_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(DMA1_Channel5_IRQn);
  /* DMA1_Channel7_IRQn (USART2_TX) */
  HAL_NVIC_SetPriority(DMA1_Channel7_IRQn, 1, 0);
  HAL_NVIC_EnableIRQ(DMA1_Channel7_IRQn);
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

  /*Configure GPIO pin : ISR_Pin (high while a USART1 reception interrupt runs) */
  HAL_GPIO_WritePin(ISR_GPIO_Port, ISR_Pin, GPIO_PIN_RESET);
  GPIO_InitStruct.Pin = ISR_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(ISR_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pins : JMP_NORMAL_Pin JMP_IT_Pin (experiment jumpers) */
  GPIO_InitStruct.Pin = JMP_NORMAL_Pin|JMP_IT_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(JMP_GPIO_Port, &GPIO_InitStruct);

  /* USER CODE BEGIN MX_GPIO_Init_2 */
  if (HAL_GPIO_ReadPin(JMP_GPIO_Port, JMP_NORMAL_Pin) == GPIO_PIN_RESET)
  {
    rx_mode = RX_DMA_NORMAL_ONCE;
  }
  else if (HAL_GPIO_ReadPin(JMP_GPIO_Port, JMP_IT_Pin) == GPIO_PIN_RESET)
  {
    rx_mode = RX_INTERRUPT;
  }
  /* USER CODE END MX_GPIO_Init_2 */
}

/* USER CODE BEGIN 4 */

static void start_reception(void)
{
  HAL_StatusTypeDef st = rx_mode == RX_INTERRUPT ? HAL_UARTEx_ReceiveToIdle_IT(&huart1, it_buf, MSG_MAX)
                                                 : HAL_UARTEx_ReceiveToIdle_DMA(&huart1, rx_ring, RX_RING_SIZE);
  if (st != HAL_OK)
  {
    Error_Handler();
  }
}

static void append(uint8_t c)
{
  if (cur.len < MSG_MAX)
  {
    cur.text[cur.len++] = (char)c;
  }
}

static void add_event(const char *name)
{
  uint32_t n = 0;
  while (cur.events[n] != '\0')
  {
    n++;
  }
  if (n != 0U && n < sizeof cur.events - 1U)
  {
    cur.events[n++] = ' ';
  }
  while (*name != '\0' && n < sizeof cur.events - 1U)
  {
    cur.events[n++] = *name++;
  }
  cur.events[n] = '\0';
}

/* IDLE: the message is complete — hand it to the main loop */
static void finish_message(void)
{
  if (q_head - q_tail < MSG_QUEUE_DEPTH)
  {
    Msg *m = &msgq[q_head % MSG_QUEUE_DEPTH];
    *m = cur;
    m->text[m->len] = '\0';
    q_head++;
  }
  cur.len = 0;
  cur.events[0] = '\0';
}

/* Reception event (ISR context). Circular DMA: Size = the DMA write position
   in rx_ring (1..32). Normal DMA / interrupt mode: Size = bytes received. */
void HAL_UARTEx_RxEventCallback(UART_HandleTypeDef *huart, uint16_t Size)
{
  if (huart->Instance != USART1)
  {
    return;
  }
  const HAL_UART_RxEventTypeTypeDef ev = HAL_UARTEx_GetRxEventType(huart);
  if (rx_mode == RX_DMA_CIRCULAR)
  {
    for (uint32_t i = rx_pos; i < Size; i++)
    {
      append(rx_ring[i]);
    }
    rx_pos = Size % RX_RING_SIZE;
  }
  else
  {
    const uint8_t *src = rx_mode == RX_INTERRUPT ? it_buf : rx_ring;
    for (uint32_t i = 0; i < Size; i++)
    {
      append(src[i]);
    }
  }
  add_event(ev == HAL_UART_RXEVENT_HT ? "ht" : ev == HAL_UART_RXEVENT_TC ? "tc" : "idle");
  if (ev == HAL_UART_RXEVENT_IDLE)
  {
    finish_message();
    if (rx_mode == RX_INTERRUPT)
    {
      start_reception(); /* the interrupt reception ends at IDLE: re-arm it */
    }
    /* RX_DMA_NORMAL_ONCE: the HAL stopped the DMA at IDLE and nothing
       restarts it — every later byte is lost (USART overrun) */
  }
}

/* USART1_IRQHandler: the line went idle right after the ring wrapped. */
void App_IdleAtWrap(void)
{
  if (cur.len != 0U)
  {
    add_event("idle");
    finish_message();
  }
}

/* mini_printf() sink: blocking USART1 transmit (86.8 us per byte at 115200 Bd). */
void mini_putchar(char c)
{
  HAL_UART_Transmit(&huart1, (const uint8_t *)&c, 1, 10);
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
