/** Window chrome: document identity plus the save affordance. */
import { useApp } from '../state/store'
import { FolderIcon, SaveIcon } from './Icons'

export function TitleBar({ onOpen }: { onOpen: () => void }) {
  const status = useApp((s) => s.status)
  const fileName = useApp((s) => s.fileName)
  const pageCount = useApp((s) => s.pages.length)
  const marks = useApp((s) => s.elements.length)
  const dirty = useApp((s) => s.dirty)
  const saving = useApp((s) => s.saving)
  const writable = useApp((s) => s.writable)
  const save = useApp((s) => s.save)

  const ready = status === 'ready'

  return (
    <header className="titlebar">
      <div className="titlebar__drag" />

      {ready ? (
        <div className="titlebar__doc">
          <span className="titlebar__name" title={fileName}>
            {fileName}
          </span>
          {dirty && <span className="dot-dirty" title="Unsaved changes" />}
          <span className="titlebar__meta">
            {pageCount} page{pageCount === 1 ? '' : 's'}
            {marks > 0 && ` · ${marks} mark${marks === 1 ? '' : 's'}`}
            {!writable && ' · read-only'}
          </span>
        </div>
      ) : (
        <div className="titlebar__doc">
          <span className="titlebar__name">Inkwell</span>
        </div>
      )}

      <button type="button" className="btn" onClick={onOpen} title="Open a PDF (⌘O)">
        <FolderIcon size={14} />
        Open
      </button>

      {ready && (
        <>
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() => void save('save-as')}
            title="Save a copy (⇧⌘S)"
          >
            Save As…
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || (!dirty && writable)}
            onClick={() => void save('save')}
            title="Save (⌘S)"
          >
            <SaveIcon size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </header>
  )
}
