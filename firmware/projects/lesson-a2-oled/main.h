/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (lesson-a2-oled).
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

/* USER CODE BEGIN Private defines */
/** SSD1306 7-bit address 0x3C (SA0 = 0, the module default), HAL wants it shifted */
#define OLED_ADDR (0x3CU << 1)
#define OLED_W 128
#define OLED_H 64
#define OLED_PAGES (OLED_H / 8)
/** PB12: the charge-pump experiment jumper (input pull-up; tied to GND at reset = 8Dh 14h left out) */
#define CP_JUMPER_Pin GPIO_PIN_12
#define CP_JUMPER_GPIO_Port GPIOB
/** one frame every FRAME_MS HAL ticks */
#define FRAME_MS 200U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
