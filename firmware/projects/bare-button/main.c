/*
 * bare-button — register-level button mirror: no HAL, no interrupts, no
 * SysTick. Runs on the 8 MHz HSI the core starts from after reset (RCC_CFGR
 * SW = 00, RM0008 §7.2.6), with zero flash wait states (FLASH_ACR reset value).
 *
 *   PA0  input with internal pull-up, push-button to GND (pressed = 0)
 *   PA5  push-pull output, HIGH while the button is pressed
 *   PC13 push-pull output to the Blue Pill's on-board LED (active low):
 *        LOW (LED on) while the button is pressed
 *
 * The main loop polls GPIOA_IDR and writes BSRR only when the mirrored state
 * changes, so every output edge is exactly one register write after the
 * input edge (a few loop iterations at most). No debouncing: contact bounce
 * on PA0 is mirrored to the outputs edge for edge, which is the point of this
 * example (watch it on the logic analyzer).
 */
#include "stm32f1xx.h"

/* CNF/MODE nibble values of GPIOx_CRL/CRH (RM0008 §9.2.1, Table 20/21) */
#define CR_INPUT_PULL 0x8u  /* CNF=10 MODE=00: input with pull-up/pull-down (ODR selects) */
#define CR_OUTPUT_PP_2MHZ 0x2u /* CNF=00 MODE=10: general-purpose push-pull, 2 MHz */

int main(void) {
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN | RCC_APB2ENR_IOPCEN;
  /* read back so the clock enable has reached the APB2 bridge before the
     first GPIO access (same idiom as the HAL __HAL_RCC_GPIOx_CLK_ENABLE) */
  (void)RCC->APB2ENR;

  /* PA0 pull direction comes from ODR0 in CNF=10 mode (RM0008 Table 20:
     ODR=1 → pull-up). Set ODR0 BEFORE switching the pin to pull mode so it
     never passes through pull-down (ODR resets to 0). PA5 starts low. */
  GPIOA->BSRR = GPIO_BSRR_BS0 | GPIO_BSRR_BR5;
  GPIOA->CRL = (GPIOA->CRL & ~(GPIO_CRL_CNF0 | GPIO_CRL_MODE0 | GPIO_CRL_CNF5 | GPIO_CRL_MODE5)) |
               (CR_INPUT_PULL << GPIO_CRL_MODE0_Pos) | (CR_OUTPUT_PP_2MHZ << GPIO_CRL_MODE5_Pos);

  /* PC13 high (LED off) before it becomes an output */
  GPIOC->BSRR = GPIO_BSRR_BS13;
  GPIOC->CRH = (GPIOC->CRH & ~(GPIO_CRH_CNF13 | GPIO_CRH_MODE13)) | (CR_OUTPUT_PP_2MHZ << GPIO_CRH_MODE13_Pos);

  uint32_t shown = 0; /* state currently on the outputs: 0 = released */
  for (;;) {
    const uint32_t pressed = (GPIOA->IDR & GPIO_IDR_IDR0) == 0;
    if (pressed != shown) {
      shown = pressed;
      if (pressed) {
        GPIOA->BSRR = GPIO_BSRR_BS5;  /* PA5 high */
        GPIOC->BSRR = GPIO_BSRR_BR13; /* PC13 low: LED on */
      } else {
        GPIOA->BSRR = GPIO_BSRR_BR5;
        GPIOC->BSRR = GPIO_BSRR_BS13;
      }
    }
  }
}
