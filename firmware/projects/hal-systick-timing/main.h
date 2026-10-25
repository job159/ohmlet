/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-systick-timing).
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

/* Exported variables --------------------------------------------------------*/
/* USER CODE BEGIN EV */
/** set by main() once PB13 is an output; SysTick_Handler toggles PB13 only then */
extern volatile uint8_t tick_out_enabled;
/* USER CODE END EV */

/* Exported functions prototypes ---------------------------------------------*/
void Error_Handler(void);

/* Private defines -----------------------------------------------------------*/
#define TICK_OUT_Pin GPIO_PIN_13
#define TICK_OUT_GPIO_Port GPIOB
#define DELAY_OUT_Pin GPIO_PIN_14
#define DELAY_OUT_GPIO_Port GPIOB

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
