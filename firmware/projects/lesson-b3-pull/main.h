/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (lesson-b3-pull).
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
#define BTN_UP_Pin GPIO_PIN_0
#define BTN_UP_GPIO_Port GPIOA
#define BTN_DOWN_Pin GPIO_PIN_1
#define BTN_DOWN_GPIO_Port GPIOA
#define LED_Pin GPIO_PIN_13
#define LED_GPIO_Port GPIOC

/* USER CODE BEGIN Private defines */
/** input report period on USART1 */
#define REPORT_PERIOD_MS 100U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
