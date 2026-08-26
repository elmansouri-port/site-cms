/*
 * PublishBar — the one place anything goes live from.
 *
 * The friction in most CMS interfaces is not the editing, it is not knowing
 * where you are: whether what you typed is saved, whether saved means visible,
 * and what "publish" is about to do. Three separate buttons labelled Save,
 * Publish and Unpublish, sitting in a page header, answer none of that.
 *
 * So this is a sticky bar that always says the same four things in the same
 * order: what state this is in, whether there is anything unsaved, how to look
 * at it, and the one action that moves it forward. The primary button changes
 * label with the state — "Publish", "Publish changes", "Save draft" — because
 * the interesting question is never "do you want to save" but "will people see
 * this".
 */
import { Icon, Badge } from './ui.jsx';

export default function PublishBar({
  status,            // 'published' | 'draft'
  dirty,
  busy,
  canEdit,
  onSave,
  onPublish,
  onUnpublish,
  onPreview,
  viewUrl,
  savedAt,
  publishedAt,
  children,
}) {
  const live = status === 'published';

  // The primary action is whatever actually moves this forward from here.
  const primary = !live
    ? { label: dirty ? 'Save & publish' : 'Publish', run: onPublish }
    : dirty
      ? { label: 'Publish changes', run: onPublish }
      : null;

  return (
    <div className={`pubbar ${dirty ? 'is-dirty' : ''}`}>
      <div className="pubbar__state">
        <Badge tone={live ? 'ok' : 'warn'}>{live ? 'Live' : 'Draft'}</Badge>
        <span className="pubbar__where">
          {live
            ? (dirty
              ? 'Live, with unsaved changes visitors cannot see yet'
              : 'Visible to everyone')
            : (dirty
              ? 'Not published, and you have unsaved changes'
              : 'Only you can see this')}
        </span>
      </div>

      {children && <div className="pubbar__extra">{children}</div>}

      <span className="pubbar__spacer" />

      <div className="pubbar__times">
        {savedAt && <span>Saved {savedAt}</span>}
        {live && publishedAt && <span>Published {publishedAt}</span>}
      </div>

      <div className="pubbar__actions">
        {onPreview && (
          <button className="btn btn--sm" onClick={onPreview} disabled={busy}>
            <Icon name="eye" /> Preview
          </button>
        )}
        {live && viewUrl && (
          <a className="btn btn--sm" href={viewUrl} target="_blank" rel="noreferrer">
            <Icon name="external" /> View live
          </a>
        )}

        {canEdit && (
          <>
            <button
              className={`btn btn--sm ${!primary && dirty ? 'btn--primary' : ''}`}
              onClick={onSave}
              disabled={busy || !dirty}
            >
              <Icon name="save" /> {busy ? 'Saving…' : live ? 'Save' : 'Save draft'}
            </button>

            {primary && (
              <button className="btn btn--sm btn--primary" onClick={primary.run} disabled={busy}>
                <Icon name="check" /> {primary.label}
              </button>
            )}

            {live && onUnpublish && (
              <button className="btn btn--sm" onClick={onUnpublish} disabled={busy} title="Take this off the site">
                Unpublish
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The numbered steps across the top of an editor.
 *
 * Not decoration: it tells somebody who has never used this what order the work
 * goes in, and it marks which steps still have something wrong with them, so
 * "why can I not publish this" is answerable by looking.
 */
export function Steps({ steps, active, onChange }) {
  return (
    <ol className="steps">
      {steps.map((step, i) => (
        <li key={step.value} className={active === step.value ? 'is-active' : ''}>
          <button type="button" onClick={() => onChange(step.value)}>
            <span className="steps__num">{step.done ? '✓' : i + 1}</span>
            <span className="steps__text">
              <strong>{step.label}</strong>
              {step.hint && <span>{step.hint}</span>}
            </span>
            {step.problems > 0 && <span className="steps__badge">{step.problems}</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}
