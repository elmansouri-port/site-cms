import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Shell from './components/Shell.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { Spinner } from './components/ui/index.js';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PagesList from './pages/PagesList.jsx';
import PageEditor from './pages/PageEditor.jsx';
import Strings from './pages/Strings.jsx';
import BlogList from './pages/BlogList.jsx';
import BlogEditor from './pages/BlogEditor.jsx';
import MediaLibrary from './pages/MediaLibrary.jsx';
import NavigationEditor from './pages/NavigationEditor.jsx';
import SettingsPage from './pages/Settings.jsx';
import Leads from './pages/Leads.jsx';
import Redirects from './pages/Redirects.jsx';
import Experiments from './pages/Experiments.jsx';
import ExperimentDetail from './pages/ExperimentDetail.jsx';
import Users from './pages/Users.jsx';
import Partners from './pages/Partners.jsx';
import ChromeEditor from './pages/ChromeEditor.jsx';
import Integrations from './pages/Integrations.jsx';
import Forms from './pages/Forms.jsx';
import FormEditor from './pages/FormEditor.jsx';
import AuditLog from './pages/AuditLog.jsx';

export default function App() {
  const { user, ready } = useAuth();

  if (!ready) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Spinner label="Signing you in…" />
      </div>
    );
  }
  if (!user) return <Login />;

  return (
    <Shell>
      <ScreenBoundary>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/pages" element={<PagesList />} />
          <Route path="/pages/:key" element={<PageEditor />} />
          <Route path="/content" element={<Strings />} />
          <Route path="/blog" element={<BlogList />} />
          <Route path="/blog/:id" element={<BlogEditor />} />
          <Route path="/media" element={<MediaLibrary />} />
          <Route path="/navigation" element={<NavigationEditor />} />
          <Route path="/chrome" element={<ChromeEditor />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/forms" element={<Forms />} />
          <Route path="/forms/:key" element={<FormEditor />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/partners" element={<Partners />} />
          <Route path="/experiments" element={<Experiments />} />
          <Route path="/experiments/:key" element={<ExperimentDetail />} />
          <Route path="/redirects" element={<Redirects />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/users" element={<Users />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ScreenBoundary>
    </Shell>
  );
}

/**
 * The boundary around whatever screen is showing.
 *
 * Keyed on the route, because a boundary that has caught an error stays caught
 * until it is remounted — without the key, one broken screen would keep showing
 * its error panel after navigating away from it, and the admin would look
 * permanently broken over a transient failure.
 *
 * Inside the Shell rather than around it, so the sidebar and the topbar stay
 * usable: there is always a way to somewhere that works.
 */
function ScreenBoundary({ children }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}
