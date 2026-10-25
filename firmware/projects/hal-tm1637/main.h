/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-tm1637).
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
#define TM_CLK_Pin GPIO_PIN_6
#define TM_CLK_GPIO_Port GPIOB
#define TM_DIO_Pin GPIO_PIN_7
#define TM_DIO_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/** counter period (HAL ticks) */
#define STEP_MS 100U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
