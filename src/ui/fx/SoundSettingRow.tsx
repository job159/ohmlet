/**
 * 更多 →「音效」 (owner: vivid): ONE settings row with a switch — the
 * celebration chime, the burn pop and the quiet place / wire / delete ticks
 * (src/ui/fx/sound.ts). Default on, quiet; the choice is remembered per
 * browser ('bb.sound'). Turning it on plays the chime once as a preview
 * (the switch press is the user gesture). New chrome only — the classic
 * chrome's More sheet keeps its original rows.
 */
import { ListRow, Switch } from '../kit'
import { t } from '../../i18n'
import { playCue, useSound } from './sound'

export function SoundSettingRow() {
  const enabled = useSound((s) => s.enabled)
  const setEnabled = useSound((s) => s.setEnabled)
  return (
    <ListRow
      title={t('Sound')}
      subtitle={t('A chime when a lesson passes or a circuit works, a pop when a part burns, quiet clicks while building')}
      trailing={
        <Switch
          checked={enabled}
          onChange={(on) => {
            setEnabled(on)
            if (on) playCue('success', { short: true })
          }}
          aria-label={t('Sound')}
        />
      }
    />
  )
}
