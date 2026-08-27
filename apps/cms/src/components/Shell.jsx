import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity, ArrowRightLeft, ExternalLink, FileText, FlaskConical, Image, LayoutDashboard,
  LayoutPanelTop, Languages, LogOut, Mail, MapPin, Menu as MenuIcon, Monitor, Moon,
  Newspaper, Plug, Search, Settings as SettingsIcon, Sun, Users as UsersIcon, X,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { useTheme } from '../lib/theme.jsx';
import { cn } from '../lib/cn.js';
import CommandPalette from './CommandPalette.jsx';
import {
  Button, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Segmented, Tooltip,
} from './ui/index.js';

/*
 * The sidebar, grouped the way the work actually divides.
 *
 * "Pages" and "Everywhere" is the distinction that matters once the header and
 * footer stopped living inside each page: some things you change for one page,
 * some you change once and they land on all of them. Getting that wrong is how
 * a footer ends up edited eighteen times.
 *
 * "Growth" is separated from both because it is a different job — the person
 * running a test or reading leads is usually not the person writing the copy.
 */
export const NAV_GROUPS = [
  {
    label: 'Pages',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Overview', end: true },
      { to: '/pages', icon: FileText, label: 'Pages' },
      { to: '/blog', icon: Newspaper, label: 'Blog' },
      { to: '/media', icon: Image, label: 'Images & video' },
    ],
  },
  {
    label: 'Everywhere',
    items: [
      { to: '/chrome', icon: LayoutPanelTop, label: 'Header & footer' },
      { to: '/navigation', icon: MenuIcon, label: 'Menus' },
      { to: '/content', icon: Languages, label: 'Copy & languages' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { to: '/experiments', icon: FlaskConical, label: 'A/B tests' },
      { to: '/leads', icon: Mail, label: 'Leads' },
      { to: '/redirects', icon: ArrowRightLeft, label: 'Redirects' },
      { to: '/partners', icon: MapPin, label: 'Partners' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/integrations', icon: Plug, label: 'Integrations', role: 'admin' },
      { to: '/settings', icon: SettingsIcon, label: 'Settings', role: 'admin' },
      { to: '/users', icon: UsersIcon, label: 'Team', role: 'admin' },
      { to: '/audit', icon: Activity, label: 'Activity', role: 'admin' },
    ],
  },
];

const TITLES = Object.fromEntries(
  NAV_GROUPS.flatMap(g => g.items).map(i => [i.to, i.label]),
);

export default function Shell({ children }) {
  const { user, logout, can } = useAuth();
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);

  const title = TITLES[pathname] || TITLES[`/${pathname.split('/')[1]}`] || 'Rainbow CMS';
  // The page editor's visual builder wants the whole window rather than the
  // reading-width column every other screen is set in.
  const wide = /^\/pages\/[^/]+/.test(pathname) || pathname === '/chrome';

  // Close the mobile drawer on navigation, or it stays over the screen it just
  // opened.
  useEffect(() => setDrawer(false), [pathname]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-full" data-testid="app-shell">
      {/* Backdrop for the drawer on narrow screens. */}
      {drawer && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setDrawer(false)}
        />
      )}

      <aside
        className={cn(
          'bg-sidebar border-sidebar-border fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r',
          'transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          drawer ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="border-sidebar-border flex h-14 items-center gap-2.5 border-b px-4">
          <span className="bg-primary flex size-7 shrink-0 items-center justify-center rounded-lg">
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path d="M4 18a8 8 0 0 1 16 0" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-[14px] font-semibold tracking-tight">Rainbow CMS</span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto lg:hidden"
            onClick={() => setDrawer(false)}
            aria-label="Close menu"
          >
            <X />
          </Button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3" aria-label="Sections">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter(i => !i.role || can(i.role));
            if (!items.length) return null;
            return (
              <div key={group.label} className="mb-4 last:mb-0">
                <div className="text-muted-foreground px-2 pb-1.5 text-[10.5px] font-semibold tracking-wider uppercase">
                  {group.label}
                </div>
                {items.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="border-sidebar-border border-t p-2.5">
          <Menu>
            <MenuTrigger asChild>
              <button
                type="button"
                className="hover:bg-sidebar-accent/60 focus-visible:ring-ring/40 flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors outline-none focus-visible:ring-[3px]"
              >
                <span className="bg-accent text-accent-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold uppercase">
                  {initials(user.name)}
                </span>
                <span className="min-w-0 grow">
                  <span className="block truncate text-[12.5px] font-semibold">{user.name}</span>
                  <span className="text-muted-foreground block truncate text-[11.5px]">{user.role}</span>
                </span>
              </button>
            </MenuTrigger>
            <MenuContent align="start" side="top" className="w-56">
              <MenuLabel>{user.email}</MenuLabel>
              <MenuSeparator />
              <div className="px-2 py-1.5">
                <ThemeChoice />
              </div>
              <MenuSeparator />
              <MenuItem tone="danger" onSelect={logout}>
                <LogOut /> Sign out
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </aside>

      <div className="flex min-w-0 grow flex-col">
        <header className="bg-background/85 sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-md">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
            <MenuIcon />
          </Button>
          <span className="truncate text-[13.5px] font-semibold">{title}</span>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPalette(true)}
              className="text-muted-foreground hidden sm:inline-flex"
            >
              <Search /> Jump to…
              <kbd className="bg-muted ml-1 rounded px-1 font-mono text-[10.5px]">⌘K</kbd>
            </Button>
            <Button variant="ghost" size="icon-sm" className="sm:hidden" onClick={() => setPalette(true)} aria-label="Search">
              <Search />
            </Button>
            <Tooltip content="Open the live site">
              <Button variant="outline" size="icon-sm" asChild>
                <a href="/" target="_blank" rel="noreferrer" aria-label="View site">
                  <ExternalLink />
                </a>
              </Button>
            </Tooltip>
          </div>
        </header>

        <main className={cn('min-w-0 grow px-4 py-6 sm:px-6', wide ? 'max-w-none' : 'mx-auto w-full max-w-[1280px]')}>
          {children}
        </main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

function ThemeChoice() {
  const { preference, choose } = useTheme();
  return (
    <div className="grid gap-1.5">
      <span className="text-muted-foreground text-[11px] font-medium">Appearance</span>
      <Segmented
        size="sm"
        value={preference}
        onChange={choose}
        className="w-full [&>button]:grow"
        options={[
          { value: 'light', label: <Sun className="mx-auto size-3.5" />, title: 'Light' },
          { value: 'dark', label: <Moon className="mx-auto size-3.5" />, title: 'Dark' },
          { value: 'system', label: <Monitor className="mx-auto size-3.5" />, title: 'Match the system' },
        ]}
      />
    </div>
  );
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('');
}
