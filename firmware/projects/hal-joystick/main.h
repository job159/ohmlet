/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-joystick).
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
#define VRX_Pin GPIO_PIN_0
#define VRX_GPIO_Port GPIOA
#define VRY_Pin GPIO_PIN_1
#define VRY_GPIO_Port GPIOA
#define SW_Pin GPIO_PIN_12
#define SW_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
#define REPORT_PERIOD_MS 100U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
