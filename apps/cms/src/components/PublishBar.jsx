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
import { Check, ExternalLink, Eye, Save } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Badge, Button } from './ui/index.js';

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
    <div
      className={cn(
        'bg-card/95 sticky bottom-0 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-xl border',
        'px-4 py-3 shadow-lg backdrop-blur',
        dirty && 'border-primary/40',
      )}
    >
      <div className="flex items-center gap-2">
        <Badge variant={live ? 'success' : 'warning'}>{live ? 'Live' : 'Draft'}</Badge>
        <span className="text-muted-foreground text-[12.5px]">
          {live
            ? (dirty ? 'Live, with unsaved changes visitors cannot see yet' : 'Visible to everyone')
            : (dirty ? 'Not published, and you have unsaved changes' : 'Only you can see this')}
        </span>
      </div>

      {children}

      <span className="grow" />

      <div className="text-muted-foreground hidden gap-3 text-[11.5px] lg:flex">
        {savedAt && <span>Saved {savedAt}</span>}
        {live && publishedAt && <span>Published {publishedAt}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onPreview && (
          <Button variant="outline" size="sm" onClick={onPreview} disabled={busy}>
            <Eye /> Preview
          </Button>
        )}
        {live && viewUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={viewUrl} target="_blank" rel="noreferrer"><ExternalLink /> View live</a>
          </Button>
        )}

        {canEdit && (
          <>
            <Button
              variant={!primary && dirty ? 'default' : 'outline'}
              size="sm"
              onClick={onSave}
              disabled={busy || !dirty}
            >
              <Save /> {busy ? 'Saving…' : live ? 'Save' : 'Save draft'}
            </Button>

            {primary && (
              <Button size="sm" onClick={primary.run} disabled={busy}>
                <Check /> {primary.label}
              </Button>
            )}

            {live && onUnpublish && (
              <Button variant="outline" size="sm" onClick={onUnpublish} disabled={busy} title="Take this off the site">
                Unpublish
              </Button>
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
    <ol className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, i) => (
        <li key={step.value}>
          <button
            type="button"
            onClick={() => onChange(step.value)}
            aria-current={active === step.value ? 'step' : undefined}
            className={cn(
              'focus-visible:ring-ring/40 flex w-full items-center gap-2.5 rounded-lg border p-2.5',
              'text-left transition-colors outline-none focus-visible:ring-[3px]',
              active === step.value ? 'border-primary bg-accent/60' : 'bg-card hover:bg-muted',
            )}
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold',
                step.done
                  ? 'bg-success/15 text-success'
                  : active === step.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {step.done ? <Check className="size-3 stroke-3" /> : i + 1}
            </span>
            <span className="min-w-0 grow">
              <span className="block text-[13px] font-semibold">{step.label}</span>
              {step.hint && <span className="text-muted-foreground block text-[12px]">{step.hint}</span>}
            </span>
            {step.problems > 0 && <Badge variant="warning">{step.problems}</Badge>}
          </button>
        </li>
      ))}
    </ol>
  );
}
