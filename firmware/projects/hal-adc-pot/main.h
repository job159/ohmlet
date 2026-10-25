/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-adc-pot).
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
#define POT_Pin GPIO_PIN_0
#define POT_GPIO_Port GPIOA

/* USER CODE BEGIN Private defines */
/** period of the readings (HAL ticks = ms) */
#define SAMPLE_PERIOD_MS 100U
/** VDDA assumed for the mV conversion: the Blue Pill 3.3 V regulator */
#define VDDA_MV 3300U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
