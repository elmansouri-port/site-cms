import { textOf } from '@rainbow/core/article';
import { cn } from '../lib/cn.js';
import { Textarea } from './ui/index.js';

/*
 * One string, in one language.
 *
 * The wrinkle this exists for: the copy was extracted from hand-written HTML,
 * so a lot of it still carries the entities that markup used —
 * `L'&eacute;diteur fran&ccedil;ais`. Decoding it here and saving the decoded
 * form would change bytes the fidelity check compares, on strings nobody meant
 * to touch. Showing the raw value and saying nothing leaves a translator
 * reading `&eacute;` and wondering what they broke.
 *
 * So the box holds the truth and a line underneath says what it renders as.
 * Editing replaces the whole value, entities and all, which is exactly what
 * somebody rewriting the sentence intends.
 */
export default function CopyField({ locale, value, pending, disabled, onChange }) {
  const text = Array.isArray(value) ? value.join('\n') : (value ?? '');
  const rendered = textOf(text);
  const hasEntities = rendered !== String(text).replace(/\s+/g, ' ').trim();

  return (
    <label className="grid gap-1">
      <span className="text-muted-foreground text-[10.5px] font-semibold uppercase">{locale}</span>
      <Textarea
        rows={Math.min(6, Math.ceil((String(text).length || 1) / 55))}
        value={text}
        disabled={disabled}
        aria-label={`${locale} copy`}
        className={cn(pending && 'border-primary')}
        onChange={e => onChange(e.target.value)}
      />
      {hasEntities && (
        <span className="text-muted-foreground text-[11.5px] leading-snug">
          reads as: {rendered}
        </span>
      )}
    </label>
  );
}
