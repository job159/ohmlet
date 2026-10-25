/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-gpio-modes).
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
#define IN_PU_Pin GPIO_PIN_1
#define IN_PU_GPIO_Port GPIOA
#define IN_PD_Pin GPIO_PIN_2
#define IN_PD_GPIO_Port GPIOA
#define IN_FLOAT_Pin GPIO_PIN_3
#define IN_FLOAT_GPIO_Port GPIOA
#define OD_A_Pin GPIO_PIN_6
#define OD_A_GPIO_Port GPIOB
#define OD_B_Pin GPIO_PIN_7
#define OD_B_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/** PB6/PB7 toggle every 50 ms: 10 Hz square waves */
#define OD_HALF_PERIOD_MS 50U
/** input report period */
#define REPORT_PERIOD_MS 200U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
