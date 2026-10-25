/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : hal-adc-dma — ADC1 continuous scan of IN0–IN3, the
  *                   temperature sensor and VREFINT into SRAM by DMA.
  ******************************************************************************
  * Blue Pill, 72 MHz (HSE 8 MHz × PLL9), SysTick 1 kHz HAL time base.
  * ADCCLK = PCLK2 / 6 = 12 MHz.
  *
  * ADC1: scan mode, continuous, software start, right aligned, 6 ranks:
  *   1 IN0 (PA0)  2 IN1 (PA1)  3 IN2 (PA2)  4 IN3 (PA3)
  *   5 IN16 (temperature sensor)  6 IN17 (VREFINT)
  * every rank sampled 239.5 cycles (≥ 17.1 µs for the sensor, RM0008
  * §11.10): one conversion = 252 ADCCLK = 21 µs, one scan = 126 µs.
  * DMA1 channel 1 (RM0008 Table 78): peripheral → memory, half-words,
  * memory increment, circular, 6 items — adc_buf[] is rewritten every scan.
  * The transfer-complete callback (end of every scan) copies adc_buf into
  * snap[] and counts scans.
  *
  * Every REPORT_PERIOD_MS (deadline based) USART1 (PA9, 115200 8N1) prints
  *   "in0=<r> in1=<r> in2=<r> in3=<r> ts=<r> vref=<r> vdda=<mV> temp=<t> seq=<n>\r\n"
  * r = raw codes, vdda = 1200 × 4095 / vref (VREFINT typ. 1.20 V, DS5319
  * Table 12), temp = (1430 mV − Vsense) / 4.3 mV/°C + 25 with one decimal
  * (Table 50 typical values), Vsense = ts × vdda / 4095, n = completed scans.
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
ADC_HandleTypeDef hadc1;
DMA_HandleTypeDef hdma_adc1;

UART_HandleTypeDef huart1;

/* USER CODE BEGIN PV */
static uint16_t adc_buf[ADC_RANKS];          /* written by DMA1 channel 1 */
static volatile uint16_t snap[ADC_RANKS];    /* last complete scan */
static volatile uint32_t scans;              /* completed scans (DMA TC) */
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_DMA_Init(void);
static void MX_ADC1_Init(void);
static void MX_USART1_UART_Init(void);

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
  MX_ADC1_Init();
  MX_USART1_UART_Init();
  /* USER CODE BEGIN 2 */
  if (HAL_ADCEx_Calibration_Start(&hadc1) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_ADC_Start_DMA(&hadc1, (uint32_t *)adc_buf, ADC_RANKS) != HAL_OK)
  {
    Error_Handler();
  }
  uint32_t next = HAL_GetTick() + REPORT_PERIOD_MS;
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
    if ((int32_t)(HAL_GetTick() - next) >= 0)
    {
      next += REPORT_PERIOD_MS;
      uint16_t v[ADC_RANKS];
      __disable_irq();
      for (uint32_t i = 0; i < ADC_RANKS; i++)
      {
        v[i] = snap[i];
      }
      uint32_t n = scans;
      __enable_irq();
      uint32_t vdda = v[5] ? (VREFINT_MV * 4095U + v[5] / 2U) / v[5] : 0U;
      int32_t vs_mv = (int32_t)((v[4] * vdda + 2047U) / 4095U);
      /* tenths of a degree: (V25 − Vs) / slope + 25 */
      int32_t t10 = 250 + ((TS_V25_MV - vs_mv) * 10000) / TS_SLOPE_UV;
      int32_t ta = t10 < 0 ? -t10 : t10;
      mini_printf("in0=%u in1=%u in2=%u in3=%u ts=%u vref=%u vdda=%lu temp=%s%ld.%ld seq=%lu\r\n",
                  v[0], v[1], v[2], v[3], v[4], v[5], (unsigned long)vdda,
                  t10 < 0 ? "-" : "", (long)(ta / 10), (long)(ta % 10), (unsigned long)n);
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
  RCC_PeriphCLKInitTypeDef PeriphClkInit = {0};

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
  PeriphClkInit.PeriphClockSelection = RCC_PERIPHCLK_ADC;
  PeriphClkInit.AdcClockSelection = RCC_ADCPCLK2_DIV6;
  if (HAL_RCCEx_PeriphCLKConfig(&PeriphClkInit) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief ADC1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_ADC1_Init(void)
{
  ADC_ChannelConfTypeDef sConfig = {0};
  static const uint32_t channels[ADC_RANKS] = {
    ADC_CHANNEL_0, ADC_CHANNEL_1, ADC_CHANNEL_2, ADC_CHANNEL_3,
    ADC_CHANNEL_TEMPSENSOR, ADC_CHANNEL_VREFINT,
  };
  static const uint32_t ranks[ADC_RANKS] = {
    ADC_REGULAR_RANK_1, ADC_REGULAR_RANK_2, ADC_REGULAR_RANK_3,
    ADC_REGULAR_RANK_4, ADC_REGULAR_RANK_5, ADC_REGULAR_RANK_6,
  };

  /** Common config
  */
  hadc1.Instance = ADC1;
  hadc1.Init.ScanConvMode = ADC_SCAN_ENABLE;
  hadc1.Init.ContinuousConvMode = ENABLE;
  hadc1.Init.DiscontinuousConvMode = DISABLE;
  hadc1.Init.ExternalTrigConv = ADC_SOFTWARE_START;
  hadc1.Init.DataAlign = ADC_DATAALIGN_RIGHT;
  hadc1.Init.NbrOfConversion = ADC_RANKS;
  if (HAL_ADC_Init(&hadc1) != HAL_OK)
  {
    Error_Handler();
  }

  /** Configure Regular Channels
  */
  for (uint32_t i = 0; i < ADC_RANKS; i++)
  {
    sConfig.Channel = channels[i];
    sConfig.Rank = ranks[i];
    sConfig.SamplingTime = ADC_SAMPLETIME_239CYCLES_5;
    if (HAL_ADC_ConfigChannel(&hadc1, &sConfig) != HAL_OK)
    {
      Error_Handler();
    }
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
  */
static void MX_DMA_Init(void)
{
  /* DMA controller clock enable */
  __HAL_RCC_DMA1_CLK_ENABLE();

  /* DMA interrupt init */
  /* DMA1_Channel1_IRQn interrupt configuration */
  HAL_NVIC_SetPriority(DMA1_Channel1_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(DMA1_Channel1_IRQn);
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

/* End of a scan (DMA1 channel 1 transfer complete, circular): keep a stable copy. */
void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *hadc)
{
  if (hadc->Instance == ADC1)
  {
    for (uint32_t i = 0; i < ADC_RANKS; i++)
    {
      snap[i] = adc_buf[i];
    }
    scans++;
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
