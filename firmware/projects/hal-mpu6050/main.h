/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-mpu6050).
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
#define NOWAKE_Pin GPIO_PIN_12
#define NOWAKE_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/** MPU-6050 7-bit address with AD0 low (GY-521 pull-down), shifted for HAL */
#define MPU_ADDR (0x68U << 1)
/** register map (RM-MPU-6000A rev 4.2) */
#define MPU_SMPLRT_DIV   0x19U
#define MPU_CONFIG       0x1AU
#define MPU_GYRO_CONFIG  0x1BU
#define MPU_ACCEL_CONFIG 0x1CU
#define MPU_ACCEL_XOUT_H 0x3BU
#define MPU_PWR_MGMT_1   0x6BU
#define MPU_WHO_AM_I     0x75U
/** report period (ms) */
#define REPORT_PERIOD_MS 100U
/** HAL I2C timeout per transfer (ms) */
#define I2C_TIMEOUT_MS 10U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
