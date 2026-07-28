/** Empty state: open a document, or pick up where you left off. */
import iconUrl from '../assets/icon.png'
import { platform } from '../platform'
import { useApp } from '../state/store'
import { CloseIcon, DocIcon, FolderIcon } from './Icons'

export function Welcome({ onOpen, dragging }: { onOpen: () => void; dragging: boolean }) {
  const recents = useApp((s) => s.recents)
  const openRecent = useApp((s) => s.openRecent)
  const dropRecent = useApp((s) => s.dropRecent)
  const host = platform()

  return (
    <div className="welcome">
      <div className="welcome__inner">
        <img className="welcome__mark" src={iconUrl} alt="" width={76} height={76} />
        <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
          <h1>Sign and fill out PDFs</h1>
          <p>
            Open a document, drop in your signature, fill the blanks, and save. {host.storageNote}
          </p>
        </div>

        <div className="dropzone" data-over={dragging}>
          <DocIcon size={30} />
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>
            {dragging ? 'Drop it anywhere' : 'Drag a PDF here'}
          </div>
          <button type="button" className="btn btn--primary btn--lg" onClick={onOpen}>
            <FolderIcon size={15} />
            Choose a PDF…
          </button>
        </div>

        {host.hasRecents && recents.length > 0 && (
          <div className="recents">
            <div className="section-title">Recent</div>
            {recents.map((file) => (
              <div key={file.id} className="recent">
                <DocIcon size={15} />
                <button
                  type="button"
                  className="recent__name"
                  style={{ textAlign: 'left' }}
                  onClick={() => void openRecent(file)}
                  title={file.location ? `${file.location}/${file.name}` : file.name}
                >
                  {file.name}
                </button>
                {file.location && <span className="recent__path">{file.location}</span>}
                <button
                  type="button"
                  className="recent__remove"
                  title="Remove from list"
                  onClick={() => void dropRecent(file.id)}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
