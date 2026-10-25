/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-button-exti).
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
#define LED_Pin GPIO_PIN_5
#define LED_GPIO_Port GPIOA
#define BTN_Pin GPIO_PIN_12
#define BTN_GPIO_Port GPIOB
#define BTN_EXTI_IRQn EXTI15_10_IRQn

/* USER CODE BEGIN Private defines */
/** a press counts once PB12 has stayed low this many HAL ticks (ms) after its last falling edge */
#define DEBOUNCE_MS 20U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
