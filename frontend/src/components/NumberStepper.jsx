import { useLang } from '../LangContext'

const toNumber = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

const clamp = (value, min, max) => {
  let next = value
  if (Number.isFinite(min)) next = Math.max(min, next)
  if (Number.isFinite(max)) next = Math.min(max, next)
  return next
}

const cleanNumber = (value) => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000
  return String(Number.isInteger(rounded) ? rounded : rounded)
}

export default function NumberStepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  className = '',
  style,
  disabled = false,
  ...inputProps
}) {
  const { tr } = useLang()
  const minNum = min === undefined || min === null ? -Infinity : Number(min)
  const maxNum = max === undefined || max === null ? Infinity : Number(max)
  const stepNum = step === 'any' ? 1 : Number(step || 1)
  const current = toNumber(value)
  const atMin = disabled || (current !== null && Number.isFinite(minNum) && current <= minNum)
  const atMax = disabled || (current !== null && Number.isFinite(maxNum) && current >= maxNum)

  const emit = (next) => onChange?.(String(next))
  const nudge = (direction) => {
    const fallback = Number.isFinite(minNum) ? minNum : 0
    const base = current ?? fallback
    const next = clamp(base + direction * stepNum, minNum, maxNum)
    emit(cleanNumber(next))
  }
  const handleFocus = (event) => {
    inputProps.onFocus?.(event)
    if (event.defaultPrevented) return
    requestAnimationFrame(() => {
      if (document.activeElement === event.target) event.target.select()
    })
  }
  const handleMouseUp = (event) => {
    inputProps.onMouseUp?.(event)
    if (event.defaultPrevented) return
    event.preventDefault()
    event.currentTarget.select()
  }

  return (
    <span className={`number-stepper ${className}`.trim()} style={style}>
      <button
        type="button"
        className="number-stepper-btn minus"
        onClick={() => nudge(-1)}
        disabled={atMin}
        tabIndex={-1}
        aria-label={tr('number_stepper.decrease')}
        title={tr('number_stepper.decrease')}
      >
        -
      </button>
      <input
        {...inputProps}
        className={`number-stepper-input ${inputProps.className || ''}`.trim()}
        type="text"
        inputMode={step === 'any' ? 'decimal' : 'numeric'}
        role="spinbutton"
        aria-valuemin={Number.isFinite(minNum) ? minNum : undefined}
        aria-valuemax={Number.isFinite(maxNum) ? maxNum : undefined}
        aria-valuenow={current ?? undefined}
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={handleFocus}
        onMouseUp={handleMouseUp}
      />
      <button
        type="button"
        className="number-stepper-btn plus"
        onClick={() => nudge(1)}
        disabled={atMax}
        tabIndex={-1}
        aria-label={tr('number_stepper.increase')}
        title={tr('number_stepper.increase')}
      >
        +
      </button>
    </span>
  )
}
