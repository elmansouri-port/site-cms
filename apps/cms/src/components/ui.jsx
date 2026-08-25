/*
 * ui.jsx — the small set of primitives every screen is built from.
 * Keeping them in one file makes the visual language easy to keep consistent.
 */
import { useEffect, useRef } from 'react';

export function Panel({ title, actions, children, footer, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel__head">
          {title && <h2>{title}</h2>}
          {actions && <div className="inline" style={{ marginLeft: 'auto' }}>{actions}</div>}
        </header>
      )}
      <div className="panel__body">{children}</div>
      {footer && <div className="panel__foot">{footer}</div>}
    </section>
  );
}

export function Field({ label, hint, error, children, id }) {
  return (
    <label className="field" htmlFor={id}>
      {label && <span className="field__label">{label}</span>}
      {children}
      {hint && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </label>
  );
}

export function Input({ label, hint, error, ...props }) {
  return (
    <Field label={label} hint={hint} error={error}>
      <input type="text" {...props} />
    </Field>
  );
}

export function TextArea({ label, hint, error, code, rows = 4, ...props }) {
  return (
    <Field label={label} hint={hint} error={error}>
      <textarea rows={rows} className={code ? 'code' : undefined} {...props} />
    </Field>
  );
}

export function Select({ label, hint, options = [], children, ...props }) {
  return (
    <Field label={label} hint={hint}>
      <select {...props}>
        {children || options.map(o => (
          <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
        ))}
      </select>
    </Field>
  );
}

export function Checkbox({ label, ...props }) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function Badge({ tone = '', children }) {
  return <span className={`badge ${tone ? `badge--${tone}` : ''}`}>{children}</span>;
}

export function StatusBadge({ status }) {
  const tone = status === 'published' ? 'ok' : status === 'draft' ? 'warn' : status === 'new' ? 'brand' : '';
  return <Badge tone={tone}>{status}</Badge>;
}

export function Spinner({ label }) {
  return (
    <div className="loading-row">
      <span className="spinner" aria-hidden="true" />
      <span>{label || 'Loading…'}</span>
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="empty">
      <h3>That did not load</h3>
      <p>{error.message}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="modal__head">
          <h2>{title}</h2>
          <button className="btn btn--ghost btn--icon" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(t => (
        <button
          key={t.value}
          role="tab"
          aria-selected={active === t.value}
          className={`tab ${active === t.value ? 'is-active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          {t.label}{t.count !== undefined && <span className="muted"> ({t.count})</span>}
        </button>
      ))}
    </div>
  );
}

export function LocalePills({ locales, value, onChange }) {
  return (
    <div className="pill-group">
      {locales.map(l => (
        <button
          key={l}
          className={`pill ${value === l ? 'is-active' : ''}`}
          onClick={() => onChange(l)}
          type="button"
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

const PATHS = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm9 0h7V11h-7v9Zm0-16v5h7V4h-7Z',
  pages: 'M6 2h8l4 4v16H6V2Zm8 1.5V7h3.5M9 12h6M9 16h6',
  text: 'M4 5h16M7 5v14m10-9h4m-4 4h4',
  blog: 'M4 5h16v14H4zM4 9h16M8 13h8M8 16h5',
  media: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  nav: 'M4 6h16M4 12h16M4 18h10',
  leads: 'M3 6h18v12H3zM3 7l9 6 9-6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3 2-1-2-4-2 1-2-1-1-2H9L8 7 6 6 4 7l-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1v-2Z',
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 19v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  flask: 'M9 3h6M10 3v6L4 20h16L14 9V3',
  redirect: 'M4 12h14m-4-5 5 5-5 5',
  partners: 'M12 21s-7-4.6-7-10a7 7 0 1 1 14 0c0 5.4-7 10-7 10Zm0-8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  audit: 'M5 3h9l5 5v13H5zM9 13h6M9 17h6M9 9h3',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  drag: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  eyeOff: 'M4 4l16 16M10.6 6.2A9.8 9.8 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.6M6.2 8.4A17 17 0 0 0 2 12s3.6 6 10 6c1 0 2-.2 2.8-.4',
  copy: 'M9 9h11v11H9zM4 4h11v3M4 4v11h3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.5-1.5L21 21',
  logout: 'M9 21H4V3h5m6 4 5 5-5 5m5-5H9',
  chevron: 'M9 5l7 7-7 7',
  check: 'M5 13l4 4L19 7',
};

export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || PATHS.pages} />
    </svg>
  );
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}
