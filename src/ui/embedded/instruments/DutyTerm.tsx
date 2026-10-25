/**
 * 「工作週期」 in the instrument readouts as the glossary term 'duty'
 * (「工作週期（又稱佔空比）」 — UX_VERIFY §5.4): a learner who knows the
 * other word finds the meaning in one tap. The same Term (dotted underline
 * + ⓘ, Tier-S popover) the inspector uses; the classic chrome keeps its
 * plain label.
 */
import { Term } from '../controls'
import { useLegacyChrome } from '../../chrome/legacy'
import { tc } from '../text'

export function DutyTerm({ label }: { label?: string }) {
  const classic = useLegacyChrome()
  const text = label ?? tc('duty', 'meas')
  return classic ? <>{text}</> : <Term id="duty" className="ins-duty-term">{text}</Term>
}
