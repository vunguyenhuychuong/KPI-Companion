import { useView, VIEW_MODES } from '../ViewContext'
import { useLang } from '../LangContext'
import { UiIcon } from './UiIcon'

const MODE_ICONS = {
  all: 'table',
  work: 'fileText',
  personal: 'user',
  focus: 'target',
}

// Global context filter: All / Work / Personal / Focus.
export default function ViewModeSwitch() {
  const { mode, setMode } = useView()
  const { tr } = useLang()

  return (
    <div className="view-switch" role="group" aria-label={tr('view.label')}>
      {VIEW_MODES.map((m) => (
        <button
          key={m}
          className={`view-btn ${mode === m ? 'active' : ''}`}
          onClick={() => setMode(m)}
          title={tr(`view.${m}_tip`)}
        >
          <UiIcon name={MODE_ICONS[m] || 'target'} />{tr(`view.${m}`)}
        </button>
      ))}
    </div>
  )
}
