/*
 * bare-blink — register-level blink, no HAL: 8 MHz HSI (reset clock),
 * SysTick 1 ms interrupt counting milliseconds, PC13 and PA5 toggled every
 * 250 ms. Exercises RCC_APB2ENR, GPIO CRL/CRH/BSRR/ODR, SysTick and NVIC.
 */
#include "stm32f1xx.h"

static volatile uint32_t ms;

void SysTick_Handler(void) { ms++; }

static void delay_ms(uint32_t n) {
  uint32_t t0 = ms;
  while ((uint32_t)(ms - t0) < n) {
  }
}

int main(void) {
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN | RCC_APB2ENR_IOPCEN;
  (void)RCC->APB2ENR;
  /* PA5: output 2 MHz push-pull (MODE=10, CNF=00) */
  GPIOA->CRL = (GPIOA->CRL & ~(0xFu << 20)) | (0x2u << 20);
  /* PC13: output 2 MHz push-pull */
  GPIOC->CRH = (GPIOC->CRH & ~(0xFu << 20)) | (0x2u << 20);
  GPIOC->BSRR = 1u << 13; /* LED off */

  SysTick->LOAD = 8000 - 1; /* 1 ms at 8 MHz HSI */
  SysTick->VAL = 0;
  SysTick->CTRL = SysTick_CTRL_CLKSOURCE_Msk | SysTick_CTRL_TICKINT_Msk | SysTick_CTRL_ENABLE_Msk;

  for (;;) {
    GPIOA->ODR ^= 1u << 5;
    GPIOC->ODR ^= 1u << 13;
    delay_ms(250);
  }
}
