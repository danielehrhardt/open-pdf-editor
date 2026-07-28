/** Right-hand rail: the signature library, form-field list and save options. */
import { useEffect, useMemo, useState } from 'react'

import { useApp } from '../state/store'
import { useLibrary } from '../state/library'
import type { SignatureEntry } from '../types'
import { PlusIcon, StarIcon, TrashIcon } from './Icons'
import { scrollToPage } from './Viewer'

type Tab = 'sign' | 'fields'

export function Rail() {
  const fields = useApp((s) => s.fields)
  const [tab, setTab] = useState<Tab>('sign')

  useEffect(() => {
    if (fields.length === 0) setTab('sign')
  }, [fields.length])

  return (
    <aside className="rail" aria-label="Tools">
      {fields.length > 0 && (
        <div className="rail__tabs" role="tablist">
          <button
            className="rail__tab"
            role="tab"
            aria-selected={tab === 'sign'}
            onClick={() => setTab('sign')}
          >
            Signatures
          </button>
          <button
            className="rail__tab"
            role="tab"
            aria-selected={tab === 'fields'}
            onClick={() => setTab('fields')}
          >
            Fields ({fields.length})
          </button>
        </div>
      )}

      <div className="rail__body">
        {tab === 'sign' ? <SignaturePanel /> : <FieldsPanel />}
        <SaveOptions />
      </div>
    </aside>
  )
}

function SignaturePanel() {
  const entries = useLibrary((s) => s.entries)
  const remove = useLibrary((s) => s.remove)
  const setFavorite = useLibrary((s) => s.setFavorite)
  const setStudioOpen = useApp((s) => s.setStudioOpen)
  const armStamp = useApp((s) => s.armStamp)
  const pending = useApp((s) => s.pending)
  const toast = useApp((s) => s.toast)

  const signatures = useMemo(() => entries.filter((e) => e.kind === 'signature'), [entries])
  const initials = useMemo(() => entries.filter((e) => e.kind === 'initials'), [entries])

  const arm = (entry: SignatureEntry) => {
    if (pending?.sourceId === entry.id) {
      armStamp(null)
      return
    }
    armStamp({
      src: entry.src,
      aspect: entry.aspect,
      kind: 'signature',
      sourceId: entry.id,
      width: entry.kind === 'initials' ? 72 : 190,
      label: entry.label,
    })
    toast('Click on the page to place it.', 'info')
  }

  if (entries.length === 0) {
    return (
      <>
        <div className="section-title">Signatures</div>
        <div className="empty-lib">
          <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            No signatures yet.
            <br />
            Create one and it is saved for next time.
          </div>
          <button type="button" className="btn btn--primary" onClick={() => setStudioOpen(true)}>
            <PlusIcon size={14} /> Create signature
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="section-title">Signatures</div>
      {signatures.map((entry) => (
        <SignatureCard
          key={entry.id}
          entry={entry}
          armed={pending?.sourceId === entry.id}
          onArm={() => arm(entry)}
          onRemove={() => void remove(entry.id)}
          onFavorite={() => void setFavorite(entry.id)}
        />
      ))}

      {initials.length > 0 && <div className="section-title">Initials</div>}
      {initials.map((entry) => (
        <SignatureCard
          key={entry.id}
          entry={entry}
          armed={pending?.sourceId === entry.id}
          onArm={() => arm(entry)}
          onRemove={() => void remove(entry.id)}
          onFavorite={() => void setFavorite(entry.id)}
        />
      ))}

      <button type="button" className="btn" onClick={() => setStudioOpen(true)}>
        <PlusIcon size={14} /> New signature
      </button>
      <p className="rail__hint">
        Pick a signature, then click where it belongs. Drag to move, corners to resize.
      </p>
    </>
  )
}

function SignatureCard({
  entry,
  armed,
  onArm,
  onRemove,
  onFavorite,
}: {
  entry: SignatureEntry
  armed: boolean
  onArm: () => void
  onRemove: () => void
  onFavorite: () => void
}) {
  return (
    <div className="sigcard" data-armed={armed}>
      <button
        type="button"
        onClick={onArm}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
        }}
        title={armed ? 'Click the page to place — or click again to cancel' : 'Place on the page'}
      >
        <span className="sigcard__thumb">
          <img src={entry.src} alt="" />
        </span>
        <span className="sigcard__meta">
          <span className="sigcard__label">{entry.label}</span>
          <span className="sigcard__sub">{armed ? 'Click the page…' : sourceLabel(entry)}</span>
        </span>
      </button>

      <span className="sigcard__actions">
        <button
          type="button"
          title={entry.favorite ? 'Default signature' : 'Make default'}
          className={entry.favorite ? 'sigcard__star' : undefined}
          onClick={onFavorite}
        >
          <StarIcon size={14} filled={entry.favorite} />
        </button>
        <button type="button" className="danger" title="Delete" onClick={onRemove}>
          <TrashIcon size={14} />
        </button>
      </span>
    </div>
  )
}

const sourceLabel = (entry: SignatureEntry) =>
  entry.source === 'draw' ? 'Drawn' : entry.source === 'type' ? 'Typed' : 'Imported'

function FieldsPanel() {
  const fields = useApp((s) => s.fields)
  const formValues = useApp((s) => s.formValues)

  const filled = fields.filter((f) => {
    const v = formValues[f.name]
    return typeof v === 'boolean' ? v : Array.isArray(v) ? v.length > 0 : Boolean(String(v ?? ''))
  }).length

  return (
    <>
      <div className="section-title">
        Form fields — {filled} of {fields.length} filled
      </div>
      {fields.map((field, i) => {
        const value = formValues[field.name]
        const text =
          typeof value === 'boolean'
            ? value
              ? 'Checked'
              : ''
            : Array.isArray(value)
              ? value.join(', ')
              : String(value ?? '')

        return (
          <button
            key={`${field.name}#${i}`}
            type="button"
            className="fieldrow"
            onClick={() => scrollToPage(field.page)}
            title={`Page ${field.page + 1} — ${field.name}`}
          >
            <span className="fieldrow__name">{prettyName(field.name)}</span>
            <span className={`fieldrow__value${text ? '' : ' fieldrow__value--empty'}`}>
              {text || 'Empty'}
            </span>
          </button>
        )
      })}
      <p className="rail__hint">Click a field on the page to type into it directly.</p>
    </>
  )
}

/** AcroForm names are often "topmostSubform[0].Page1[0].f1_01[0]" — show the leaf. */
function prettyName(name: string): string {
  const leaf = name.split('.').pop() ?? name
  return leaf.replace(/\[\d+\]$/, '') || name
}

function SaveOptions() {
  const fields = useApp((s) => s.fields)
  const prefs = useApp((s) => s.prefs)
  const setPrefs = useApp((s) => s.setPrefs)

  if (fields.length === 0) return null

  return (
    <>
      <div className="section-title" style={{ marginTop: 'auto', paddingTop: 8 }}>
        When saving
      </div>
      <div className="switch">
        <span>
          Lock form fields
          <br />
          <span className="rail__hint">Recipients can read but not change them.</span>
        </span>
        <span
          className="switch__track"
          data-on={prefs.flattenForm}
          role="switch"
          aria-checked={prefs.flattenForm}
          tabIndex={0}
          onClick={() => setPrefs({ flattenForm: !prefs.flattenForm })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setPrefs({ flattenForm: !prefs.flattenForm })
          }}
        >
          <span className="switch__knob" />
        </span>
      </div>
    </>
  )
}
