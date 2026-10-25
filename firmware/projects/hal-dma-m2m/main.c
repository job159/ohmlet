/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-dma-m2m — DMA1 memory-to-memory copy of 1 KiB,
  *                   verified and timed with DWT->CYCCNT.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz × PLL9), SysTick 1 kHz HAL time base.
  *
  * DMA1 channel 1 in memory-to-memory mode (CCR.MEM2MEM, RM0008 §13.3.3):
  * source = "peripheral" side (CPAR), destination = memory side (CMAR),
  * 32-bit words, both pointers incremented, normal mode, 256 items.
  *
  * Every COPY_PERIOD_MS (deadline based; the first right after init):
  *   1. fill src[] with a pattern that changes every round, clear dst[] and
  *      put a guard word right behind it,
  *   2. t0 = DWT->CYCCNT; HAL_DMA_Start(); HAL_DMA_PollForTransfer(FULL);
  *      t1 = DWT->CYCCNT  (the cycles include HAL's start / poll overhead),
  *   3. compare dst[] with src[] and check the guard,
  *   4. print on USART1 (PA9, 115200 8N1)
  *        "m2m ok <t1 - t0>\r\n"       copy correct, guard intact
  *        "m2m FAIL <index>\r\n"       first wrong word (256 = guard hit)
  *        "m2m ERROR <HAL status>\r\n" HAL_DMA_PollForTransfer failed
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
DMA_HandleTypeDef hdma_memtomem_dma1_channel1;
UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
static uint32_t src[COPY_WORDS];
static uint32_t dst[COPY_WORDS + 1U]; /* + guard word */
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_DMA_Init(void);
static void MX_USART1_UART_Init(void);
/* USER CODE BEGIN PFP */
static void Copy_Round(uint32_t round);
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
  MX_DMA_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  /* DWT cycle counter (ARMv7-M ARM C1.8.8): TRCENA, then CYCCNTENA */
  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0U;
  DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
  uint32_t next = HAL_GetTick();
  uint32_t round = 0U;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) >= 0)
    {
      next += COPY_PERIOD_MS;
      Copy_Round(round++);
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
  * Enable DMA controller clock
  * Configure DMA for memory to memory transfers
  *   hdma_memtomem_dma1_channel1
  */
static void MX_DMA_Init(void)
{
  /* DMA controller clock enable */
  __HAL_RCC_DMA1_CLK_ENABLE();

  /* Configure DMA request hdma_memtomem_dma1_channel1 on DMA1_Channel1 */
  hdma_memtomem_dma1_channel1.Instance = DMA1_Channel1;
  hdma_memtomem_dma1_channel1.Init.Direction = DMA_MEMORY_TO_MEMORY;
  hdma_memtomem_dma1_channel1.Init.PeriphInc = DMA_PINC_ENABLE;
  hdma_memtomem_dma1_channel1.Init.MemInc = DMA_MINC_ENABLE;
  hdma_memtomem_dma1_channel1.Init.PeriphDataAlignment = DMA_PDATAALIGN_WORD;
  hdma_memtomem_dma1_channel1.Init.MemDataAlignment = DMA_MDATAALIGN_WORD;
  hdma_memtomem_dma1_channel1.Init.Mode = DMA_NORMAL;
  hdma_memtomem_dma1_channel1.Init.Priority = DMA_PRIORITY_LOW;
  if (HAL_DMA_Init(&hdma_memtomem_dma1_channel1) != HAL_OK)
  {
    Error_Handler( );
  }
}

/**
  * @brief GPIO Initialization Function
  * @param None
  * @retval None
  */
static void MX_GPIO_Init(void)
{
  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOD_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
}

/* USER CODE BEGIN 4 */

static void Copy_Round(uint32_t round)
{
  uint32_t x = 0x9E3779B9U * (round + 1U);
  for (uint32_t i = 0; i < COPY_WORDS; i++)
  {
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    src[i] = x;
    dst[i] = 0U;
  }
  dst[COPY_WORDS] = 0xDEADBEEFU;

  uint32_t t0 = DWT->CYCCNT;
  HAL_StatusTypeDef st = HAL_DMA_Start(&hdma_memtomem_dma1_channel1, (uint32_t)src, (uint32_t)dst, COPY_WORDS);
  if (st == HAL_OK)
  {
    st = HAL_DMA_PollForTransfer(&hdma_memtomem_dma1_channel1, HAL_DMA_FULL_TRANSFER, 10);
  }
  uint32_t t1 = DWT->CYCCNT;
  if (st != HAL_OK)
  {
    mini_printf("m2m ERROR %u\r\n", (unsigned)st);
    return;
  }
  uint32_t bad = COPY_WORDS + 1U;
  for (uint32_t i = 0; i < COPY_WORDS; i++)
  {
    if (dst[i] != src[i])
    {
      bad = i;
      break;
    }
  }
  if (bad > COPY_WORDS && dst[COPY_WORDS] != 0xDEADBEEFU)
  {
    bad = COPY_WORDS;
  }
  if (bad > COPY_WORDS)
  {
    mini_printf("m2m ok %lu\r\n", (unsigned long)(t1 - t0));
  }
  else
  {
    mini_printf("m2m FAIL %lu\r\n", (unsigned long)bad);
  }
}

/* mini_printf() sink: blocking USART1 transmit, one byte per call. */
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
