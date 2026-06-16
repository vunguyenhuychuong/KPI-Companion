import { useEffect, useState } from 'react'
import { useLang } from '../LangContext'
import { UiIcon } from './UiIcon'

export function Modal({ open, title, children, onClose, actions, wide }) {
  const { tr } = useLang()
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-content ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label={tr('common.close')}><UiIcon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

export function ConfirmModal({ open, title, message, confirmLabel, confirmVariant, onConfirm, onCancel }) {
  const { tr } = useLang()
  return (
    <Modal open={open} title={title} onClose={onCancel}
      actions={
        <>
          <button className="btn" onClick={onCancel}>{tr('common.cancel')}</button>
          <button className={`btn ${confirmVariant || 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  )
}

export function AlertModal({ open, title, message, type = 'info', onClose }) {
  const { tr } = useLang()
  const icon = type === 'success' ? 'checkCircle' : type === 'error' ? 'xCircle' : type === 'warning' ? 'warning' : 'info'
  return (
    <Modal open={open} title={title} onClose={onClose}
      actions={<button className="btn primary" onClick={onClose}>{tr('common.ok')}</button>}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span className={`modal-alert-icon ${type}`}><UiIcon name={icon} /></span>
        <p style={{ margin: 0 }}>{message}</p>
      </div>
    </Modal>
  )
}

export function PromptModal({ open, title, message, placeholder, confirmLabel, onConfirm, onCancel }) {
  const { tr } = useLang()
  const [value, setValue] = useState('')

  useEffect(() => { if (open) setValue('') }, [open])

  const handleConfirm = () => { onConfirm(value); setValue('') }

  return (
    <Modal open={open} title={title} onClose={onCancel}
      actions={
        <>
          <button className="btn" onClick={onCancel}>{tr('common.cancel')}</button>
          <button className="btn primary" onClick={handleConfirm}>{confirmLabel || tr('common.ok')}</button>
        </>
      }
    >
      {message && <p style={{ marginBottom: 10, color: 'var(--text)' }}>{message}</p>}
      <input
        autoFocus
        className="prompt-modal-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); if (e.key === 'Escape') onCancel() }}
      />
    </Modal>
  )
}
