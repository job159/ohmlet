/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-stepper-a4988).
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
void HAL_TIM_MspPostInit(TIM_HandleTypeDef *htim);
void Error_Handler(void);

/* Private defines -----------------------------------------------------------*/
/** STEP: PA0 = TIM2_CH1 (AF push-pull), one pulse per timer period */
#define STEP_Pin GPIO_PIN_0
#define STEP_GPIO_Port GPIOA
/** DIR = PB0, MS1 = PB12, MS2 = PB13, MS3 = PB14, EN = PB15 (active low), push-pull */
#define DIR_Pin GPIO_PIN_0
#define MS1_Pin GPIO_PIN_12
#define MS2_Pin GPIO_PIN_13
#define MS3_Pin GPIO_PIN_14
#define EN_Pin GPIO_PIN_15
#define CTRL_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/** TIM2: 72 MHz / 72 = 1 MHz (1 µs per count); ARR = step period − 1 (preloaded) */
#define TIM2_PRESCALER 71U
#define TIM2_PERIOD 999U
/** STEP high time: 10 µs (A4988 minimum 1 µs) */
#define TIM2_PULSE 10U
#define STEP_PULSE_US 10U
/** pause between moves (ms) */
#define PAUSE_MS 300U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
