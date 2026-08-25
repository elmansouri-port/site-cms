/*
 * NavigationEditor — the navbar and its megamenus.
 *
 * Items are reordered by dragging and the order is what the site renders. Each
 * megamenu has three zones; leaving `features` or `footer` empty is a real
 * choice, not an oversight, and the frontend renders no container for an empty
 * zone so `main` fills the width.
 */
import { useEffect, useMemo, useState } from 'react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, Icon, Field, LocalePills, Badge, Checkbox,
} from '../components/ui.jsx';

export default function NavigationEditor() {
  const toast = useToast();
  const { can } = useAuth();
  const menu = useResource('/navigation/main');
  const settings = useResource('/settings');
  const [items, setItems] = useState([]);
  const [locale, setLocale] = useState('fr');
  const [openKey, setOpenKey] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (menu.data?.menu) setItems(menu.data.menu.items || []); }, [menu.data]);

  const locales = useMemo(
    () => (settings.data?.settings?.locales || []).filter(l => l.active).map(l => l.code),
    [settings.data],
  );

  if (menu.loading) return <Spinner />;
  if (menu.error) return <ErrorBox error={menu.error} onRetry={menu.reload} />;

  const update = (key, updater) => {
    setItems(list => list.map(i => (i.key === key ? updater(i) : i)));
    setDirty(true);
  };

  function move(fromKey, toKey) {
    if (fromKey === toKey) return;
    const from = items.findIndex(i => i.key === fromKey);
    const to = items.findIndex(i => i.key === toKey);
    if (from < 0 || to < 0) return;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    try {
      await api.put('/navigation/main', { items });
      toast.success('Navigation saved');
      setDirty(false);
      menu.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Navigation</h1>
          <p>Drag to reorder. The order here is the order visitors see.</p>
        </div>
        <div className="page-head__actions">
          <LocalePills locales={locales.length ? locales : ['fr']} value={locale} onChange={setLocale} />
          {can('editor') && (
            <button className="btn btn--primary" onClick={save} disabled={!dirty || busy}>
              <Icon name="save" /> {busy ? 'Saving…' : 'Save navigation'}
            </button>
          )}
        </div>
      </div>

      <div className="blocks">
        {items.map(item => (
          <div key={item.key}>
            <div
              className={`block ${dragKey === item.key ? 'is-dragging' : ''}`}
              draggable={can('editor')}
              onDragStart={() => setDragKey(item.key)}
              onDragEnd={() => setDragKey(null)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => move(dragKey, item.key)}
            >
              <span className="block__handle"><Icon name="drag" /></span>
              <div className="block__body">
                <div className="block__title">{item.label?.[locale] || item.key}</div>
                <div className="block__meta">
                  <span className="mono">{item.href || 'no link'}</span>
                  {item.megamenu?.enabled && <Badge tone="brand">megamenu</Badge>}
                  {!item.visible && <Badge tone="warn">hidden</Badge>}
                </div>
              </div>
              <div className="block__actions">
                <button className="btn btn--sm" onClick={() => setOpenKey(openKey === item.key ? null : item.key)}>
                  {openKey === item.key ? 'Close' : 'Edit'}
                </button>
              </div>
            </div>

            {openKey === item.key && (
              <div style={{ padding: '12px 0 4px 22px' }}>
                <Panel>
                  <div className="grid grid--2">
                    <Field label={`Label (${locale.toUpperCase()})`}>
                      <input
                        value={item.label?.[locale] || ''}
                        disabled={!can('editor')}
                        onChange={e => update(item.key, i => ({ ...i, label: { ...i.label, [locale]: e.target.value } }))}
                      />
                    </Field>
                    <Field label="Link">
                      <input
                        className="code"
                        value={item.href || ''}
                        disabled={!can('editor')}
                        onChange={e => update(item.key, i => ({ ...i, href: e.target.value }))}
                      />
                    </Field>
                  </div>
                  <div className="inline">
                    <Checkbox
                      label="Visible"
                      checked={item.visible !== false}
                      disabled={!can('editor')}
                      onChange={e => update(item.key, i => ({ ...i, visible: e.target.checked }))}
                    />
                    <Checkbox
                      label="Has a megamenu"
                      checked={!!item.megamenu?.enabled}
                      disabled={!can('editor')}
                      onChange={e => update(item.key, i => ({ ...i, megamenu: { ...i.megamenu, enabled: e.target.checked } }))}
                    />
                  </div>

                  {item.megamenu?.enabled && (
                    <>
                      <Zone
                        title="Main zone (always shown)"
                        zone={item.megamenu.main}
                        locale={locale}
                        canEdit={can('editor')}
                        withSeeAll
                        onChange={(zone) => update(item.key, i => ({ ...i, megamenu: { ...i.megamenu, main: zone } }))}
                      />
                      <Zone
                        title="Features zone (optional)"
                        hint="Leave empty and the main zone expands to the full width — no empty container is rendered."
                        zone={item.megamenu.features}
                        locale={locale}
                        canEdit={can('editor')}
                        onChange={(zone) => update(item.key, i => ({ ...i, megamenu: { ...i.megamenu, features: zone } }))}
                      />
                      <FooterZone
                        zone={item.megamenu.footer}
                        locale={locale}
                        canEdit={can('editor')}
                        onChange={(zone) => update(item.key, i => ({ ...i, megamenu: { ...i.megamenu, footer: zone } }))}
                      />
                    </>
                  )}
                </Panel>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Zone({ title, hint, zone = {}, locale, canEdit, withSeeAll, onChange }) {
  const links = zone.links || [];
  const setLink = (i, updater) => onChange({ ...zone, links: links.map((l, idx) => (idx === i ? updater(l) : l)) });

  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <h3>{title}</h3>
      {hint && <p className="field__hint" style={{ marginBottom: 10 }}>{hint}</p>}

      <Field label={`Zone title (${locale.toUpperCase()})`}>
        <input
          value={zone.title?.[locale] || ''}
          disabled={!canEdit}
          onChange={e => onChange({ ...zone, title: { ...zone.title, [locale]: e.target.value } })}
        />
      </Field>

      {links.map((link, i) => (
        <div key={i} className="block" style={{ flexDirection: 'column', alignItems: 'stretch', marginBottom: 8 }}>
          <div className="grid grid--2">
            <Field label="Label">
              <input
                value={link.label?.[locale] || ''}
                disabled={!canEdit}
                onChange={e => setLink(i, l => ({ ...l, label: { ...l.label, [locale]: e.target.value } }))}
              />
            </Field>
            <Field label="Link">
              <input
                className="code"
                value={link.href || ''}
                disabled={!canEdit}
                onChange={e => setLink(i, l => ({ ...l, href: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Description">
            <input
              value={link.description?.[locale] || ''}
              disabled={!canEdit}
              onChange={e => setLink(i, l => ({ ...l, description: { ...l.description, [locale]: e.target.value } }))}
            />
          </Field>
          <div className="inline">
            <Field label="Icon">
              <input className="code" value={link.icon || ''} disabled={!canEdit} onChange={e => setLink(i, l => ({ ...l, icon: e.target.value }))} />
            </Field>
            <Field label="Column">
              <select value={link.column || 1} disabled={!canEdit} onChange={e => setLink(i, l => ({ ...l, column: Number(e.target.value) }))}>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </Field>
            <Field label="Style">
              <select value={link.variant || 'item'} disabled={!canEdit} onChange={e => setLink(i, l => ({ ...l, variant: e.target.value }))}>
                <option value="item">List item</option>
                <option value="showcase">Showcase card</option>
                <option value="cta">Side call to action</option>
              </select>
            </Field>
            <button
              className="btn btn--sm btn--danger"
              disabled={!canEdit}
              onClick={() => onChange({ ...zone, links: links.filter((_, idx) => idx !== i) })}
            >
              Remove
            </button>
          </div>
        </div>
      ))}

      <button
        className="btn btn--sm"
        disabled={!canEdit}
        onClick={() => onChange({ ...zone, links: [...links, { label: {}, description: {}, href: '', icon: 'chat', column: 1, variant: 'item' }] })}
      >
        <Icon name="plus" /> Add link
      </button>

      {withSeeAll && (
        <div className="grid grid--2" style={{ marginTop: 12 }}>
          <Field label={`"See all" label (${locale.toUpperCase()})`}>
            <input
              value={zone.seeAll?.[locale] || ''}
              disabled={!canEdit}
              onChange={e => onChange({ ...zone, seeAll: { ...zone.seeAll, [locale]: e.target.value } })}
            />
          </Field>
          <Field label={'"See all" link'}>
            <input className="code" value={zone.seeAllHref || ''} disabled={!canEdit} onChange={e => onChange({ ...zone, seeAllHref: e.target.value })} />
          </Field>
        </div>
      )}
    </div>
  );
}

function FooterZone({ zone = {}, locale, canEdit, onChange }) {
  return (
    <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <h3>Footer zone (optional)</h3>
      <p className="field__hint" style={{ marginBottom: 10 }}>
        Clear every field and the footer strip disappears entirely, with no leftover border or spacing.
      </p>
      <Field label={`Text (${locale.toUpperCase()})`}>
        <input
          value={zone.text?.[locale] || ''}
          disabled={!canEdit}
          onChange={e => onChange({ ...zone, text: { ...zone.text, [locale]: e.target.value } })}
        />
      </Field>
      <div className="grid grid--2">
        <Field label="Secondary button">
          <input
            value={zone.secondaryLabel?.[locale] || ''}
            disabled={!canEdit}
            onChange={e => onChange({ ...zone, secondaryLabel: { ...zone.secondaryLabel, [locale]: e.target.value } })}
          />
        </Field>
        <Field label="Secondary link">
          <input className="code" value={zone.secondaryHref || ''} disabled={!canEdit} onChange={e => onChange({ ...zone, secondaryHref: e.target.value })} />
        </Field>
        <Field label="Primary button">
          <input
            value={zone.primaryLabel?.[locale] || ''}
            disabled={!canEdit}
            onChange={e => onChange({ ...zone, primaryLabel: { ...zone.primaryLabel, [locale]: e.target.value } })}
          />
        </Field>
        <Field label="Primary link">
          <input className="code" value={zone.primaryHref || ''} disabled={!canEdit} onChange={e => onChange({ ...zone, primaryHref: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}
