/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-traffic-light).
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
#define RED_Pin GPIO_PIN_1
#define RED_GPIO_Port GPIOA
#define YELLOW_Pin GPIO_PIN_2
#define YELLOW_GPIO_Port GPIOA
#define GREEN_Pin GPIO_PIN_3
#define GREEN_GPIO_Port GPIOA
#define PED_BTN_Pin GPIO_PIN_0
#define PED_BTN_GPIO_Port GPIOB
#define PED_BTN_EXTI_IRQn EXTI0_IRQn

/* USER CODE BEGIN Private defines */
#define GREEN_MS 3000U
#define YELLOW_MS 1000U
#define RED_MS 3000U
/** a pedestrian request cuts the current green to this total length */
#define WALK_GREEN_MS 1000U
/** a press counts once PB0 has stayed low this many HAL ticks (ms) after its last falling edge */
#define DEBOUNCE_MS 20U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
