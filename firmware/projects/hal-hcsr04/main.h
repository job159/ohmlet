/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-hcsr04).
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
#define ECHO_Pin GPIO_PIN_6
#define ECHO_GPIO_Port GPIOB
#define TRIG_Pin GPIO_PIN_12
#define TRIG_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/** trigger pulse (>= 10 us) */
#define TRIG_US 12U
/** measurement cycle (the module needs >= 60 ms) */
#define PERIOD_MS 100U
/** echo pulses this long or longer are the module's no-echo timeout (38 ms) */
#define OUT_OF_RANGE_US 30000U
/** speed of sound used for the conversion: 343 m/s = 0.0343 cm/us */
#define SOUND_CM_PER_US_X10000 343U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
