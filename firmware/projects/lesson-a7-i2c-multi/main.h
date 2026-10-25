/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (lesson-a7-i2c-multi).
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
/** scanned 7-bit address range (0x00-0x07 and 0x78-0x7F are reserved, I2C-bus spec §3.1.12) */
#define SCAN_FIRST   0x08U
#define SCAN_LAST    0x77U
/** HAL_I2C_IsDeviceReady timeout per probe (ms) */
#define SCAN_TIMEOUT_MS 2U
/** the bus is scanned (and the readings printed) once per cycle */
#define CYCLE_MS     1000U

/** the three devices of the lesson's bus (7-bit addresses) */
#define EE_ADDR7     0x50U  /* AT24C02, A2 = A1 = A0 = 0 */
#define IMU_ADDR7    0x68U  /* MPU-6050, AD0 = 0 (0x69 with AD0 = 1) */
#define ENV_ADDR7    0x76U  /* BME280, SDO = 0 (0x77 with SDO = 1) */

/** AT24C02 test block: 8 bytes at 0x20 = one page (0x20-0x27) */
#define EE_START     0x20U
#define EE_LEN       8U
/** give up waiting for the write cycle (t_WR max 5 ms) after this many ms */
#define EE_WRITE_TIMEOUT_MS 20U

/** MPU-6050 registers (RM-MPU-6000A) */
#define MPU_SMPLRT_DIV   0x19U
#define MPU_CONFIG       0x1AU
#define MPU_GYRO_CONFIG  0x1BU
#define MPU_ACCEL_CONFIG 0x1CU
#define MPU_ACCEL_XOUT_H 0x3BU
#define MPU_PWR_MGMT_1   0x6BU
#define MPU_WHO_AM_I     0x75U

/** BME280 registers (datasheet §5.3) */
#define BMX_CALIB00   0x88U
#define BMX_CALIB_H1  0xA1U
#define BMX_ID        0xD0U
#define BMX_CALIB26   0xE1U
#define BMX_CTRL_HUM  0xF2U
#define BMX_STATUS    0xF3U
#define BMX_CTRL_MEAS 0xF4U
#define BMX_DATA      0xF7U
#define BME280_CHIP_ID 0x60U
/** oversampling x1 for T, P and H, forced mode: one conversion takes about 8 ms */
#define OSRS_X1       1U
#define MODE_FORCED   1U
#define CONVERSION_TIMEOUT_MS 50U

/** blocking transfer timeout (ms) */
#define I2C_TIMEOUT_MS 10U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
