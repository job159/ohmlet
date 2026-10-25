/*
 * Shared pieces of the soc-* integration firmware (not a project itself: no
 * project.json). Written the way STM32CubeIDE generates them: HAL clock
 * configuration, USART1 on PA9/PA10, MSP callbacks, CubeMX interrupt file.
 */
#ifndef SOC_COMMON_H
#define SOC_COMMON_H
#include "stm32f1xx_hal.h"

extern UART_HandleTypeDef huart1;

/* HSE 8 MHz × PLL9 = 72 MHz, AHB /1, APB1 /2 (36 MHz), APB2 /1, 2 wait states */
void soc_clock_72mhz(void);
/* back to the 8 MHz HSI, PLL and HSE switched off, 0 wait states */
void soc_clock_hsi(void);
/* (re)initialise USART1 8N1 at `baud`, BRR computed by HAL from the current PCLK2 */
void soc_uart1_init(uint32_t baud);
void Error_Handler(void);

#endif
