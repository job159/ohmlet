/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-rs485 — two MAX485 RS-485 nodes on one bus, driven
  *                   by two USARTs of the same Blue Pill: ping-pong.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz x PLL9), SysTick 1 kHz HAL time base.
  * Node A: USART1 PA9 (TX) -> MAX485 #1 DI, PA10 (RX) <- RO,
  *         PA8 -> DE and RE (tied): high = transmit, low = receive.
  * Node B: USART3 PB10 (TX) -> MAX485 #2 DI, PB11 (RX) <- RO,
  *         PB12 -> DE and RE (tied).
  * Both modules on 5 V, A to A and B to B; each module's 120 Ohm R7
  * terminates one end of the bus. RO is a 5 V output, so both RX pins are
  * 5 V-tolerant ones (PA10, PB11; USART2's PA3 is not, DS5319 Table 5).
  * Both USARTs 115200 8N1; reception by RXNE interrupts into ring buffers
  * (HAL_UART_Receive_IT, one byte at a time) so a node hears the other
  * while the CPU is busy sending.
  * USART2 PA2 (TX), 115200 8N1: report.
  *
  * Report:
  *   "RS-485 ping-pong: A=USART1 (DE PA8) <-> B=USART3 (DE PB12), 115200 8N1\r\n"
  *   for i = 1 .. ROUNDS:
  *     A sends "PING i\r\n" (DE high, blocking transmit up to TC, DE low),
  *     B waits for a line (REPLY_TIMEOUT_MS) and answers "PONG i\r\n",
  *     A waits for a line:
  *     "round i: B got 'PING i', A got 'PONG i'\r\n"
  *     a missing line: "round i: B heard nothing\r\n" / "round i: A heard nothing\r\n"
  *   "rs485 ok\r\n" when every round matched, else "rs485 FAILED\r\n".
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
UART_HandleTypeDef huart3;

/* USER CODE BEGIN PV */
typedef struct
{
  volatile uint8_t buf[RING_SIZE];
  volatile uint32_t head;
  volatile uint32_t tail;
  uint8_t byte;
} Ring;

static Ring ringA; /* bytes received by node A (USART1) */
static Ring ringB; /* bytes received by node B (USART3) */
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART_Init(UART_HandleTypeDef *h, USART_TypeDef *inst);
/* USER CODE BEGIN PFP */
static void node_send(UART_HandleTypeDef *h, GPIO_TypeDef *dePort, uint16_t dePin, const char *s);
static int node_readline(Ring *r, char *buf, uint32_t size, uint32_t timeout_ms);
static int str_eq(const char *a, const char *b);
/* USER CODE END PFP */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_USART_Init(&huart1, USART1);
  MX_USART_Init(&huart2, USART2);
  MX_USART_Init(&huart3, USART3);
  /* USER CODE BEGIN 2 */
  HAL_UART_Receive_IT(&huart1, &ringA.byte, 1);
  HAL_UART_Receive_IT(&huart3, &ringB.byte, 1);
  mini_printf("RS-485 ping-pong: A=USART1 (DE PA8) <-> B=USART3 (DE PB12), 115200 8N1\r\n");

  uint32_t good = 0;
  for (uint32_t i = 1; i <= ROUNDS; i++)
  {
    char msg[16];
    char want[16];
    char gotB[32];
    char gotA[32];
    mini_snprintf(msg, sizeof(msg), "PING %lu\r\n", (unsigned long)i);
    node_send(&huart1, GPIOA, GPIO_PIN_8, msg);
    if (node_readline(&ringB, gotB, sizeof(gotB), REPLY_TIMEOUT_MS) < 0)
    {
      mini_printf("round %lu: B heard nothing\r\n", (unsigned long)i);
      continue;
    }
    mini_snprintf(msg, sizeof(msg), "PONG %lu\r\n", (unsigned long)i);
    node_send(&huart3, GPIOB, GPIO_PIN_12, msg);
    if (node_readline(&ringA, gotA, sizeof(gotA), REPLY_TIMEOUT_MS) < 0)
    {
      mini_printf("round %lu: B got '%s', A heard nothing\r\n", (unsigned long)i, gotB);
      continue;
    }
    mini_printf("round %lu: B got '%s', A got '%s'\r\n", (unsigned long)i, gotB, gotA);
    mini_snprintf(want, sizeof(want), "PING %lu", (unsigned long)i);
    int okB = str_eq(gotB, want);
    mini_snprintf(want, sizeof(want), "PONG %lu", (unsigned long)i);
    if (okB && str_eq(gotA, want))
    {
      good++;
    }
  }
  mini_printf(good == ROUNDS ? "rs485 ok\r\n" : "rs485 FAILED\r\n");
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    __WFI();
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
  }
  /* USER CODE END 3 */
}

/* USER CODE BEGIN 4 */

/** Half-duplex transmit: driver on, bytes out until TC (HAL waits for it), driver off. */
static void node_send(UART_HandleTypeDef *h, GPIO_TypeDef *dePort, uint16_t dePin, const char *s)
{
  uint32_t n = 0;
  while (s[n] != '\0')
  {
    n++;
  }
  HAL_GPIO_WritePin(dePort, dePin, GPIO_PIN_SET);
  HAL_UART_Transmit(h, (const uint8_t *)s, (uint16_t)n, 100);
  HAL_GPIO_WritePin(dePort, dePin, GPIO_PIN_RESET);
}

/** One LF-terminated line from a node's ring (CR dropped); -1 on timeout. */
static int node_readline(Ring *r, char *buf, uint32_t size, uint32_t timeout_ms)
{
  uint32_t n = 0;
  uint32_t start = HAL_GetTick();
  while (HAL_GetTick() - start < timeout_ms)
  {
    if (r->tail == r->head)
    {
      continue;
    }
    uint8_t c = r->buf[r->tail];
    r->tail = (r->tail + 1) % RING_SIZE;
    if (c == '\r')
    {
      continue;
    }
    if (c == '\n')
    {
      buf[n] = '\0';
      return (int)n;
    }
    if (n + 1 < size)
    {
      buf[n++] = (char)c;
    }
  }
  return -1;
}

static int str_eq(const char *a, const char *b)
{
  while (*a != '\0' && *a == *b)
  {
    a++;
    b++;
  }
  return *a == *b;
}

/** RXNE interrupt: store the byte, re-arm the one-byte reception. */
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
  Ring *r = huart->Instance == USART1 ? &ringA : huart->Instance == USART3 ? &ringB : 0;
  if (r == 0)
  {
    return;
  }
  uint32_t next = (r->head + 1) % RING_SIZE;
  if (next != r->tail)
  {
    r->buf[r->head] = r->byte;
    r->head = next;
  }
  HAL_UART_Receive_IT(huart, &r->byte, 1);
}

/** A framing / noise / overrun error aborts the IT reception: re-arm it. */
void HAL_UART_ErrorCallback(UART_HandleTypeDef *huart)
{
  Ring *r = huart->Instance == USART1 ? &ringA : huart->Instance == USART3 ? &ringB : 0;
  if (r != 0)
  {
    HAL_UART_Receive_IT(huart, &r->byte, 1);
  }
}

/* mini_printf() sink: blocking USART2 transmit (report). */
void mini_putchar(char c)
{
  HAL_UART_Transmit(&huart2, (const uint8_t *)&c, 1, 10);
}

/* USER CODE END 4 */

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
  * @brief USARTx Initialization: 115200 8N1, TX + RX.
  */
static void MX_USART_Init(UART_HandleTypeDef *h, USART_TypeDef *inst)
{
  h->Instance = inst;
  h->Init.BaudRate = 115200;
  h->Init.WordLength = UART_WORDLENGTH_8B;
  h->Init.StopBits = UART_STOPBITS_1;
  h->Init.Parity = UART_PARITY_NONE;
  h->Init.Mode = UART_MODE_TX_RX;
  h->Init.HwFlowCtl = UART_HWCONTROL_NONE;
  h->Init.OverSampling = UART_OVERSAMPLING_16;
  if (HAL_UART_Init(h) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief GPIO Initialization Function: DE/RE outputs, low = receive.
  */
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};

  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  HAL_GPIO_WritePin(GPIOA, GPIO_PIN_8, GPIO_PIN_RESET);
  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET);

  GPIO_InitStruct.Pin = GPIO_PIN_8;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

  GPIO_InitStruct.Pin = GPIO_PIN_12;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);
}

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
