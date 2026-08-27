/*
 * NavigationEditor — the navbar and its megamenus.
 *
 * Items are reordered by dragging and the order is what the site renders. Each
 * megamenu has three zones; leaving `features` or `footer` empty is a real
 * choice, not an oversight, and the frontend renders no container for an empty
 * zone so `main` fills the width.
 *
 * Every link goes through the same picker the page blocks use, so a menu entry
 * is stored as `page:<key>` and survives a URL rename in any language — the
 * navigation being the one place where a stale link is seen on every page.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, GripVertical, Plus, Save, Trash2 } from 'lucide-react';
import { useDirtyGuard, useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { cn } from '../lib/cn.js';
import LinkPicker from '../components/LinkPicker.jsx';
import HistoryPanel from '../components/HistoryPanel.jsx';
import {
  Badge, Button, Callout, Card, CardContent, CardHeader, CardTitle, CheckboxField, Code,
  ErrorBox, Field, FieldGroupLabel, FieldRow, Input, PageHeader, Segmented, Select, Spinner,
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '../components/ui/index.js';

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
  const [tab, setTab] = useState('menu');

  useEffect(() => { if (menu.data?.menu) setItems(menu.data.menu.items || []); }, [menu.data]);
  useDirtyGuard(dirty);

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
    if (!fromKey || fromKey === toKey) return;
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
      toast.success('Navigation saved — the live site is updating');
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
      <PageHeader
        title="Menus"
        description="Drag to reorder. The order here is the order visitors see, on every page."
      >
        <Segmented
          value={locale}
          onChange={setLocale}
          options={(locales.length ? locales : ['fr']).map(l => ({ value: l, label: l.toUpperCase() }))}
        />
        {can('editor') && (
          <Button onClick={save} disabled={!dirty || busy}>
            <Save /> {busy ? 'Saving…' : 'Save navigation'}
          </Button>
        )}
      </PageHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="menu" count={items.length}>Main menu</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="menu">
          {dirty && (
            <Callout tone="warning" className="mb-3">
              Unsaved changes. Nothing reaches the site until you save.
            </Callout>
          )}

          <div className="grid gap-2">
            {items.map(item => (
              <div key={item.key}>
                <div
                  className={cn(
                    'bg-card flex items-center gap-2 rounded-lg border p-2.5 transition-opacity',
                    dragKey === item.key && 'opacity-40',
                  )}
                  draggable={can('editor')}
                  onDragStart={() => setDragKey(item.key)}
                  onDragEnd={() => setDragKey(null)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => move(dragKey, item.key)}
                >
                  <span className={cn('text-muted-foreground shrink-0', can('editor') ? 'cursor-grab' : 'opacity-30')}>
                    <GripVertical className="size-4" />
                  </span>
                  <div className="min-w-0 grow">
                    <div className="truncate text-[13px] font-medium">
                      {item.label?.[locale] || <span className="text-warning italic">Not translated to {locale.toUpperCase()}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Code>{item.href || 'no link'}</Code>
                      {item.megamenu?.enabled && <Badge variant="primary">megamenu</Badge>}
                      {item.visible === false && <Badge variant="warning">hidden</Badge>}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenKey(openKey === item.key ? null : item.key)}
                  >
                    <ChevronDown className={cn('transition-transform', openKey === item.key && 'rotate-180')} />
                    {openKey === item.key ? 'Close' : 'Edit'}
                  </Button>
                </div>

                {openKey === item.key && (
                  <Card className="mt-2 ml-6">
                    <CardContent className="grid gap-4">
                      <FieldRow>
                        <Field label={`Label (${locale.toUpperCase()})`}>
                          {id => (
                            <Input
                              id={id}
                              value={item.label?.[locale] || ''}
                              disabled={!can('editor')}
                              onChange={e => update(item.key, i => ({ ...i, label: { ...i.label, [locale]: e.target.value } }))}
                            />
                          )}
                        </Field>
                        <LinkPicker
                          label="Goes to"
                          value={item.href || ''}
                          disabled={!can('editor')}
                          onChange={href => update(item.key, i => ({ ...i, href }))}
                        />
                      </FieldRow>

                      <div className="flex flex-wrap gap-5">
                        <CheckboxField
                          label="Visible"
                          checked={item.visible !== false}
                          disabled={!can('editor')}
                          onChange={v => update(item.key, i => ({ ...i, visible: v }))}
                        />
                        <CheckboxField
                          label="Has a megamenu"
                          checked={!!item.megamenu?.enabled}
                          disabled={!can('editor')}
                          onChange={v => update(item.key, i => ({ ...i, megamenu: { ...i.megamenu, enabled: v } }))}
                        />
                      </div>

                      {item.megamenu?.enabled && (
                        <>
                          <Zone
                            title="Main zone"
                            hint="Always shown."
                            zone={item.megamenu.main}
                            locale={locale}
                            canEdit={can('editor')}
                            withSeeAll
                            onChange={(zone) => update(item.key, i => ({ ...i, megamenu: { ...i.megamenu, main: zone } }))}
                          />
                          <Zone
                            title="Features zone"
                            hint="Optional. Leave it empty and the main zone expands to the full width — no empty container is rendered."
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
                    </CardContent>
                  </Card>
                )}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="history">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <HistoryPanel entity="navigation" entityId="main" name="the main menu" onRestored={menu.reload} />
            <Card>
              <CardHeader><CardTitle>Why the menu has a history</CardTitle></CardHeader>
              <CardContent className="prose-sm">
                <p>
                  The navigation appears on every page, so a mistake in it is a mistake on the whole
                  site at once — and it is edited by whoever is running a campaign, not by whoever
                  built it.
                </p>
                <p>
                  A restore point is written before each save. Restoring puts the whole menu back,
                  including every megamenu zone and every translated label.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Zone({ title, hint, zone = {}, locale, canEdit, withSeeAll, onChange }) {
  const links = zone.links || [];
  const setLink = (i, updater) => onChange({
    ...zone,
    links: links.map((l, idx) => (idx === i ? updater(l) : l)),
  });

  return (
    <div className="grid gap-4">
      <FieldGroupLabel hint={hint}>{title}</FieldGroupLabel>

      <Field label={`Zone title (${locale.toUpperCase()})`}>
        {id => (
          <Input
            id={id}
            value={zone.title?.[locale] || ''}
            disabled={!canEdit}
            onChange={e => onChange({ ...zone, title: { ...zone.title, [locale]: e.target.value } })}
          />
        )}
      </Field>

      {links.map((link, i) => (
        <div key={i} className="grid gap-4 rounded-lg border p-3">
          <FieldRow>
            <Field label="Label">
              {id => (
                <Input
                  id={id}
                  value={link.label?.[locale] || ''}
                  disabled={!canEdit}
                  onChange={e => setLink(i, l => ({ ...l, label: { ...l.label, [locale]: e.target.value } }))}
                />
              )}
            </Field>
            <LinkPicker
              label="Goes to"
              value={link.href || ''}
              disabled={!canEdit}
              onChange={href => setLink(i, l => ({ ...l, href }))}
            />
          </FieldRow>
          <Field label="Description" hint="The line under the label in the megamenu.">
            {id => (
              <Input
                id={id}
                value={link.description?.[locale] || ''}
                disabled={!canEdit}
                onChange={e => setLink(i, l => ({ ...l, description: { ...l.description, [locale]: e.target.value } }))}
              />
            )}
          </Field>
          <FieldRow cols={3}>
            <Field label="Icon">
              {id => (
                <Input
                  id={id}
                  mono
                  value={link.icon || ''}
                  disabled={!canEdit}
                  onChange={e => setLink(i, l => ({ ...l, icon: e.target.value }))}
                />
              )}
            </Field>
            <Field label="Column">
              {id => (
                <Select
                  id={id}
                  value={link.column || 1}
                  disabled={!canEdit}
                  options={[{ value: 1, label: '1' }, { value: 2, label: '2' }]}
                  onChange={e => setLink(i, l => ({ ...l, column: Number(e.target.value) }))}
                />
              )}
            </Field>
            <Field label="Style">
              {id => (
                <Select
                  id={id}
                  value={link.variant || 'item'}
                  disabled={!canEdit}
                  onChange={e => setLink(i, l => ({ ...l, variant: e.target.value }))}
                >
                  <option value="item">List item</option>
                  <option value="showcase">Showcase card</option>
                  <option value="cta">Side call to action</option>
                </Select>
              )}
            </Field>
          </FieldRow>
          <Button
            variant="ghost"
            size="sm"
            className="hover:text-destructive justify-self-start"
            disabled={!canEdit}
            onClick={() => onChange({ ...zone, links: links.filter((_, idx) => idx !== i) })}
          >
            <Trash2 /> Remove this link
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        disabled={!canEdit}
        onClick={() => onChange({
          ...zone,
          links: [...links, { label: {}, description: {}, href: '', icon: 'chat', column: 1, variant: 'item' }],
        })}
      >
        <Plus /> Add link
      </Button>

      {withSeeAll && (
        <FieldRow>
          <Field label={`“See all” label (${locale.toUpperCase()})`}>
            {id => (
              <Input
                id={id}
                value={zone.seeAll?.[locale] || ''}
                disabled={!canEdit}
                onChange={e => onChange({ ...zone, seeAll: { ...zone.seeAll, [locale]: e.target.value } })}
              />
            )}
          </Field>
          <LinkPicker
            label="“See all” goes to"
            value={zone.seeAllHref || ''}
            disabled={!canEdit}
            onChange={href => onChange({ ...zone, seeAllHref: href })}
          />
        </FieldRow>
      )}
    </div>
  );
}

function FooterZone({ zone = {}, locale, canEdit, onChange }) {
  return (
    <div className="grid gap-4">
      <FieldGroupLabel hint="Clear every field and the footer strip disappears entirely, with no leftover border or spacing.">
        Footer zone
      </FieldGroupLabel>

      <Field label={`Text (${locale.toUpperCase()})`}>
        {id => (
          <Input
            id={id}
            value={zone.text?.[locale] || ''}
            disabled={!canEdit}
            onChange={e => onChange({ ...zone, text: { ...zone.text, [locale]: e.target.value } })}
          />
        )}
      </Field>
      <FieldRow>
        <Field label="Secondary button">
          {id => (
            <Input
              id={id}
              value={zone.secondaryLabel?.[locale] || ''}
              disabled={!canEdit}
              onChange={e => onChange({ ...zone, secondaryLabel: { ...zone.secondaryLabel, [locale]: e.target.value } })}
            />
          )}
        </Field>
        <LinkPicker
          label="Secondary goes to"
          value={zone.secondaryHref || ''}
          disabled={!canEdit}
          onChange={href => onChange({ ...zone, secondaryHref: href })}
        />
        <Field label="Primary button">
          {id => (
            <Input
              id={id}
              value={zone.primaryLabel?.[locale] || ''}
              disabled={!canEdit}
              onChange={e => onChange({ ...zone, primaryLabel: { ...zone.primaryLabel, [locale]: e.target.value } })}
            />
          )}
        </Field>
        <LinkPicker
          label="Primary goes to"
          value={zone.primaryHref || ''}
          disabled={!canEdit}
          onChange={href => onChange({ ...zone, primaryHref: href })}
        />
      </FieldRow>
    </div>
  );
}
