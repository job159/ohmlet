/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-hall).
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
#define HALL_Pin GPIO_PIN_12
#define HALL_GPIO_Port GPIOB
#define HALL_EXTI_IRQn EXTI15_10_IRQn
#define LED_Pin GPIO_PIN_13
#define LED_GPIO_Port GPIOC

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
