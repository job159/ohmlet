/**
 * 更多 →「音效」 (owner: vivid): ONE settings row with a switch — the
 * celebration chime, the burn pop and the mechanical sounds of building and
 * using the circuit (parts plugged in and pulled out, wires, buttons,
 * switches, relays — src/ui/fx/sound.ts, mech-watch.ts). Default on, quiet;
 * the choice is remembered per browser ('bb.sound'). Turning it on plays a
 * button click and then the chime as a preview (the switch press is the
 * user gesture). New chrome only — the classic chrome's More sheet keeps its
 * original rows.
 */
import { ListRow, Switch } from '../kit'
import { t } from '../../i18n'
import { playCue, playMech, useSound } from './sound'

/** the chime follows the click by this long (ms) in the preview */
const PREVIEW_CHIME_MS = 90

export function SoundSettingRow() {
  const enabled = useSound((s) => s.enabled)
  const setEnabled = useSound((s) => s.setEnabled)
  return (
    <ListRow
      title={t('Sound')}
      subtitle={t('A chime when a lesson passes or a circuit works, a pop when a part burns, and the mechanical sounds of plugging in parts, wires, buttons, switches and relays')}
      trailing={
        <Switch
          checked={enabled}
          onChange={(on) => {
            setEnabled(on)
            if (!on) return
            playMech('press')
            setTimeout(() => playCue('success', { short: true }), PREVIEW_CHIME_MS)
          }}
          aria-label={t('Sound')}
        />
      }
    />
  )
}
