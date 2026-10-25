/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-tft-st7735).
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
#define TFT_CS_Pin GPIO_PIN_4
#define TFT_CS_GPIO_Port GPIOA
#define TFT_DC_Pin GPIO_PIN_0
#define TFT_DC_GPIO_Port GPIOB
#define TFT_RES_Pin GPIO_PIN_1
#define TFT_RES_GPIO_Port GPIOB
#define TFT_BL_Pin GPIO_PIN_10
#define TFT_BL_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
#define TFT_W 128
#define TFT_H 160
/** "frame N" redraw period (HAL ticks) */
#define FRAME_MS 500U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
