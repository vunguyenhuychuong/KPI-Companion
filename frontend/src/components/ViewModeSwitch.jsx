import { useView, VIEW_MODES } from '../ViewContext'
import { useLang } from '../LangContext'

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
          {tr(`view.${m}`)}
        </button>
      ))}
    </div>
  )
}
