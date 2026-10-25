/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-dc-motor).
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
/** speed PWM: PA0 = TIM2_CH1 (AF push-pull) */
#define PWM_Pin GPIO_PIN_0
#define PWM_GPIO_Port GPIOA
/** L298N IN1 / IN2 (direction): PB0 / PB1, push-pull */
#define IN1_Pin GPIO_PIN_0
#define IN2_Pin GPIO_PIN_1
#define IN1_GPIO_Port GPIOB
#define IN2_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/** TIM2: 72 MHz / 72 = 1 MHz, ARR 999 → 1 kHz PWM; CCR1 = 10 × duty % (1000 = always high) */
#define TIM2_PRESCALER 71U
#define TIM2_PERIOD 999U
#define TIM2_PULSE 0U
/** every phase of the demo lasts PHASE_MS HAL ticks */
#define PHASE_MS 400U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
