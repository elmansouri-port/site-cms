import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Shell from './components/Shell.jsx';
import { Spinner } from './components/ui.jsx';

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
import Users from './pages/Users.jsx';
import Partners from './pages/Partners.jsx';
import ChromeEditor from './pages/ChromeEditor.jsx';
import Integrations from './pages/Integrations.jsx';
import AuditLog from './pages/AuditLog.jsx';

export default function App() {
  const { user, ready } = useAuth();

  if (!ready) {
    return <div className="login"><Spinner label="Signing you in…" /></div>;
  }
  if (!user) return <Login />;

  return (
    <Shell>
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
        <Route path="/leads" element={<Leads />} />
        <Route path="/partners" element={<Partners />} />
        <Route path="/experiments" element={<Experiments />} />
        <Route path="/redirects" element={<Redirects />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/users" element={<Users />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
