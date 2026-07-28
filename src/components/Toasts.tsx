/** Transient status messages. */
import { useApp } from '../state/store'
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon } from './Icons'

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <span className="toast__icon">
            {toast.tone === 'success' ? (
              <CheckCircleIcon size={15} />
            ) : toast.tone === 'error' ? (
              <AlertIcon size={15} />
            ) : (
              <InfoIcon size={15} />
            )}
          </span>
          <span style={{ flex: 1 }}>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                toast.action?.run()
                dismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="toast__close" onClick={() => dismiss(toast.id)}>
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
