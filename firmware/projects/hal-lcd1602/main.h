/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-lcd1602).
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
#define LCD_E_Pin GPIO_PIN_1
#define LCD_E_GPIO_Port GPIOB
#define LCD_RS_Pin GPIO_PIN_10
#define LCD_RS_GPIO_Port GPIOB
#define LCD_RW_Pin GPIO_PIN_11
#define LCD_RW_GPIO_Port GPIOB
#define LCD_D4_Pin GPIO_PIN_12
#define LCD_D4_GPIO_Port GPIOB
#define LCD_D5_Pin GPIO_PIN_13
#define LCD_D5_GPIO_Port GPIOB
#define LCD_D6_Pin GPIO_PIN_14
#define LCD_D6_GPIO_Port GPIOB
#define LCD_D7_Pin GPIO_PIN_15
#define LCD_D7_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/** counter update period (HAL ticks) */
#define STEP_MS 250U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
