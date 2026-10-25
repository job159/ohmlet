/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-bh1750).
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
/** BH1750 7-bit address with ADDR low (GY-302 pull-down), shifted for HAL */
#define BH1750_ADDR (0x23U << 1)
/** instructions (BH1750FVI datasheet, "Instruction Set Architecture") */
#define BH1750_POWER_ON  0x01U
#define BH1750_CONT_HRES 0x10U
/** report period (ms): longer than the H-resolution measurement time (180 ms max) */
#define REPORT_PERIOD_MS 200U
#define I2C_TIMEOUT_MS 10U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
