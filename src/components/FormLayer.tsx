/** Interactive overlay for a page's AcroForm widgets. */
import { CheckIcon } from './Icons'
import { useApp, type FormValue } from '../state/store'
import type { FormFieldInfo } from '../types'

interface Props {
  fields: FormFieldInfo[]
  zoom: number
}

export function FormLayer({ fields, zoom }: Props) {
  const formValues = useApp((s) => s.formValues)
  const setFormValue = useApp((s) => s.setFormValue)

  return (
    <>
      {fields.map((field, i) => (
        <FieldWidget
          key={`${field.name}#${i}`}
          field={field}
          zoom={zoom}
          value={formValues[field.name]}
          onChange={(v) => setFormValue(field.name, v)}
        />
      ))}
    </>
  )
}

function FieldWidget({
  field,
  zoom,
  value,
  onChange,
}: {
  field: FormFieldInfo
  zoom: number
  value: FormValue | undefined
  onChange: (value: FormValue) => void
}) {
  const style: React.CSSProperties = {
    left: field.x * zoom,
    top: field.y * zoom,
    width: field.w * zoom,
    height: field.h * zoom,
  }

  if (field.readOnly) return null

  // Text size is derived from the widget height so filled values sit sensibly
  // inside the box the document author drew.
  const fontSize = Math.min(14, Math.max(7, field.h * 0.62)) * zoom
  const filled = Boolean(
    typeof value === 'boolean' ? value : Array.isArray(value) ? value.length : String(value ?? ''),
  )

  const className = `field${filled ? ' field--filled' : ''}`

  if (field.type === 'checkbox' || field.type === 'radio') {
    const on =
      field.type === 'checkbox'
        ? Boolean(value)
        : String(value ?? '') === (field.exportValue ?? 'On')

    return (
      <div className={className} style={style}>
        <button
          type="button"
          className="field__toggle"
          aria-pressed={on}
          title={field.name}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (field.type === 'checkbox') onChange(!on)
            else onChange(on ? 'Off' : (field.exportValue ?? 'On'))
          }}
        >
          {on && <CheckIcon size={Math.max(9, Math.min(field.w, field.h) * zoom)} />}
        </button>
      </div>
    )
  }

  if (field.type === 'dropdown' || field.type === 'optionlist') {
    const current = Array.isArray(value) ? (value[0] ?? '') : String(value ?? '')
    return (
      <div className={className} style={style}>
        <select
          value={current}
          title={field.name}
          style={{ fontSize }}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange(field.type === 'optionlist' ? [e.target.value] : e.target.value)}
        >
          <option value="">—</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    )
  }

  const text = Array.isArray(value) ? value.join(' ') : String(value ?? '')

  return (
    <div className={className} style={style}>
      {field.multiline ? (
        <textarea
          value={text}
          title={field.name}
          maxLength={field.maxLen}
          style={{ fontSize, lineHeight: 1.25 }}
          spellCheck={false}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          value={text}
          title={field.name}
          maxLength={field.maxLen}
          style={{ fontSize }}
          spellCheck={false}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
