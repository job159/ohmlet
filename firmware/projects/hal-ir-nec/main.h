/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file (hal-ir-nec).
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
#define IR_Pin GPIO_PIN_12
#define IR_GPIO_Port GPIOB
#define IR_EXTI_IRQn EXTI15_10_IRQn

/* USER CODE BEGIN Private defines */
/**
 * NEC timing of the demodulated (active-low) output in us: leader burst
 * 9 ms then a 4.5 ms space (frame) or a 2.25 ms space (repeat code); every
 * bit is a 562.5 us burst followed by a 562.5 us (0) or 1687.5 us (1)
 * space. Accepted within +-20 % (leader / spaces) and +-40 % (bit times).
 */
#define NEC_LEADER_MARK_US 9000U
#define NEC_FRAME_SPACE_US 4500U
#define NEC_REPEAT_SPACE_US 2250U
#define NEC_BIT_MARK_US 562U
#define NEC_ZERO_SPACE_US 562U
#define NEC_ONE_SPACE_US 1687U
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
