/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-dht — DHT22 / AM2302 single-wire read-out timed with DWT->CYCCNT.
  ******************************************************************************
  * Blue Pill, 72 MHz, SysTick 1 kHz. DHT22 module DATA -> PB12 (5 V
  * tolerant), configured as an OPEN-DRAIN output that idles released: the
  * module's 10 kOhm pull-up holds the line high and the input buffer still
  * reads the pin (RM0008 §9.1.8). USART1 PA9 115200 8N1.
  *
  * Microsecond timing uses the Cortex-M3 cycle counter DWT->CYCCNT
  * (DEMCR.TRCENA + DWT_CTRL.CYCCNTENA; 72 cycles per us).
  *
  * Boot: "DHT22 on PB12 (DWT timing)\r\n". First read 2.5 s after boot (the
  * sensor ignores the bus for 2 s after power-up), then every 2.5 s:
  *   host start: PB12 low 1.2 ms, released;
  *   with interrupts masked: sensor answer (low within 200 us, 80 us low,
  *   80 us high), then 40 bits — each bit's high time is measured,
  *   > 40 us = 1 (26-28 us = 0, 70 us = 1);
  *   checksum = low byte of the sum of bytes 0-3.
  * Output: "RH=<%>.<d> T=[-]<C>.<d>\r\n" (RH = (b0 << 8 | b1) / 10,
  * T = ((b2 & 0x7F) << 8 | b3) / 10, negative when b2 bit 7 is set), or
  * "DHT22: no response\r\n", "DHT22: timeout in bit <n>\r\n",
  * "DHT22: checksum error\r\n". Note: the DHT22 always sends its PREVIOUS
  * measurement (taken after the last read).
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

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void dwt_init(void);
static void delay_us(uint32_t us);
static int wait_level(uint32_t level, uint32_t timeout_us, uint32_t *elapsed_us);
static int dht_read(uint8_t d[5], int *bit);
/* USER CODE END PFP */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* Configure the system clock */
  SystemClock_Config();

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  dwt_init();
  mini_printf("DHT22 on PB12 (DWT timing)\r\n");
  uint32_t next = HAL_GetTick() + DHT_FIRST_MS;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) < 0)
    {
      __WFI();
      continue;
    }
    next += DHT_PERIOD_MS;
    uint8_t d[5];
    int bit = 0;
    int r = dht_read(d, &bit);
    if (r == 1)
    {
      mini_printf("DHT22: no response\r\n");
      continue;
    }
    if (r == 2)
    {
      mini_printf("DHT22: timeout in bit %d\r\n", bit);
      continue;
    }
    if ((uint8_t)(d[0] + d[1] + d[2] + d[3]) != d[4])
    {
      mini_printf("DHT22: checksum error\r\n");
      continue;
    }
    uint32_t rh10 = ((uint32_t)d[0] << 8) | d[1];
    uint32_t t10 = ((uint32_t)(d[2] & 0x7F) << 8) | d[3];
    mini_printf("RH=%lu.%lu T=%s%lu.%lu\r\n", (unsigned long)(rh10 / 10U), (unsigned long)(rh10 % 10U),
                (d[2] & 0x80) ? "-" : "", (unsigned long)(t10 / 10U), (unsigned long)(t10 % 10U));
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

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
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

  /** Initializes the CPU, AHB and APB buses clocks
  */
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

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pin Output Level: released (open drain high = off) */
  HAL_GPIO_WritePin(DHT_GPIO_Port, DHT_Pin, GPIO_PIN_SET);

  /*Configure GPIO pin : DHT_Pin */
  GPIO_InitStruct.Pin = DHT_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_OD;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(DHT_GPIO_Port, &GPIO_InitStruct);
}

/* USER CODE BEGIN 4 */

/* Cycle counter: DEMCR.TRCENA, CYCCNT = 0, CYCCNTENA (ARMv7-M ARM C1.8). */
static void dwt_init(void)
{
  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0;
  DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

static void delay_us(uint32_t us)
{
  uint32_t t0 = DWT->CYCCNT;
  uint32_t n = us * (SystemCoreClock / 1000000U);
  while (DWT->CYCCNT - t0 < n)
  {
  }
}

/* Wait until the line reads `level`; 0 on timeout. `elapsed_us` = time waited. */
static int wait_level(uint32_t level, uint32_t timeout_us, uint32_t *elapsed_us)
{
  uint32_t cpu = SystemCoreClock / 1000000U;
  uint32_t t0 = DWT->CYCCNT;
  uint32_t n = timeout_us * cpu;
  while (((DHT_GPIO_Port->IDR & DHT_Pin) ? 1U : 0U) != level)
  {
    if (DWT->CYCCNT - t0 > n)
    {
      return 0;
    }
  }
  if (elapsed_us)
  {
    *elapsed_us = (DWT->CYCCNT - t0) / cpu;
  }
  return 1;
}

/* One transaction: 0 ok, 1 no response, 2 timeout inside the frame (*bit = bit index). */
static int dht_read(uint8_t d[5], int *bit)
{
  for (int i = 0; i < 5; i++)
  {
    d[i] = 0;
  }
  DHT_GPIO_Port->BRR = DHT_Pin; /* start: pull low */
  delay_us(DHT_START_US);
  DHT_GPIO_Port->BSRR = DHT_Pin; /* release */
  __disable_irq();
  int result = 0;
  if (!wait_level(0, 200, 0))
  {
    result = 1;
  }
  else if (!wait_level(1, 100, 0) || !wait_level(0, 100, 0))
  {
    result = 2;
    *bit = -1;
  }
  else
  {
    for (int i = 0; i < 40; i++)
    {
      uint32_t high = 0;
      if (!wait_level(1, 80, 0) || !wait_level(0, 100, &high))
      {
        result = 2;
        *bit = i;
        break;
      }
      d[i >> 3] = (uint8_t)((d[i >> 3] << 1) | (high > DHT_ONE_THRESHOLD_US ? 1U : 0U));
    }
  }
  __enable_irq();
  return result;
}

/* mini_printf() sink: blocking USART1 transmit, one byte per call (86.8 us at 115200 Bd). */
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
  /* USER CODE BEGIN Error_Handler_Debug */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}

#ifdef  USE_FULL_ASSERT
void assert_failed(uint8_t *file, uint32_t line)
{
  (void)file;
  (void)line;
}
#endif /* USE_FULL_ASSERT */
