/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-ds18b20).
  ******************************************************************************
  */
/* USER CODE END Header */

/* Define to prevent recursive inclusion -------------------------------------*/
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

/* Includes ------------------------------------------------------------------*/
#include "stm32f1xx_hal.h"

/* Exported functions prototypes ---------------------------------------------*/
void Error_Handler(void);

/* Private defines -----------------------------------------------------------*/
#define OW_Pin GPIO_PIN_12
#define OW_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/** 1-Wire standard-speed timing (us), Maxim AN126 */
#define OW_RESET_LOW_US 500U
#define OW_PRESENCE_SAMPLE_US 70U
#define OW_RESET_TAIL_US 430U
#define OW_SLOT_US 65U
/** commands (DS18B20 datasheet) */
#define OW_READ_ROM 0x33U
#define OW_SKIP_ROM 0xCCU
#define DS_CONVERT_T 0x44U
#define DS_READ_SCRATCHPAD 0xBEU
/** measurement period (ms) and conversion timeout (750 ms max at 12 bit) */
#define REPORT_PERIOD_MS 1000U
#define CONVERSION_TIMEOUT_MS 1000U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
