/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-adc-dma).
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
/** conversions per scan: IN0, IN1, IN2, IN3, IN16 (temperature), IN17 (VREFINT) */
#define ADC_RANKS 6U
/** period of the report lines (HAL ticks = ms) */
#define REPORT_PERIOD_MS 200U
/** VREFINT typical (DS5319 Table 12), mV */
#define VREFINT_MV 1200U
/** temperature sensor V25 (mV) and Avg_Slope (uV/degC), DS5319 Table 50 typical */
#define TS_V25_MV 1430
#define TS_SLOPE_UV 4300
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
