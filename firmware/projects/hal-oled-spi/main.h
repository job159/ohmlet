/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-oled-spi).
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
#define OLED_CS_Pin GPIO_PIN_4
#define OLED_CS_GPIO_Port GPIOA
#define OLED_DC_Pin GPIO_PIN_0
#define OLED_DC_GPIO_Port GPIOB
#define OLED_RES_Pin GPIO_PIN_1
#define OLED_RES_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
#define OLED_W 128
#define OLED_H 64
#define OLED_PAGES (OLED_H / 8)
/** one frame every FRAME_MS HAL ticks */
#define FRAME_MS 200U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
