/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-lcd1602-i2c).
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
/** PCF8574 7-bit address 0x27 (A2..A0 pads open = pulled up), HAL wants it shifted */
#define LCD_ADDR (0x27U << 1)
/** backpack port bits: P0 = RS, P1 = RW, P2 = E, P3 = backlight, P4..P7 = D4..D7 */
#define LCD_RS 0x01U
#define LCD_RW 0x02U
#define LCD_E  0x04U
#define LCD_BL 0x08U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
