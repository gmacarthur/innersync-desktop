import { useEffect, useMemo, useState } from 'react';

type SyncStatus = {
  state: string;
  paused: boolean;
  running: boolean;
  lastRun?: string;
  lastResult?: {
    status: string;
    payloadHash?: string;
    message?: string;
    reason?: string;
  };
};

type HistoryEntry = {
  timestamp: string;
  status: string;
  reason: string;
  payloadHash?: string;
  message?: string;
  skippedReason?: string;
};

type SettingsForm = {
  baseDir: string;
  autoLaunch: boolean;
  watchFiles: string[];
  autoUpdate: boolean;
};

type Screen = 'login' | 'dashboard' | 'settings';

const WATCH_LABELS = [
  'Base timetable (.tfx)',
  'Year 7 file',
  'Year 8 file',
  'Year 9 file',
  'Year 10 file',
  'Year 11 file',
  'Year 12 file',
];

const EMPTY_WATCH_FILES = WATCH_LABELS.map(() => '');

const normalizeWatchFiles = (input?: string[]) => {
  const next = [...EMPTY_WATCH_FILES];
  if (Array.isArray(input) && input.length > 0) {
    input.forEach((value, index) => {
      if (index < next.length) {
        next[index] = value ?? '';
      }
    });
  }
  return next;
};

function App() {
  const DATE_LOCALE = 'en-AU';

  const [version, setVersion] = useState<string>('...');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [form, setForm] = useState<SettingsForm>({
    baseDir: '',
    autoLaunch: false,
    watchFiles: [...EMPTY_WATCH_FILES],
    autoUpdate: true,
  });
  const [saving, setSaving] = useState(false);
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
    remember: false,
  });
  const [loginStatus, setLoginStatus] = useState<{ state: 'idle' | 'pending' | 'success' | 'error'; message?: string }>({
    state: 'idle',
  });
  const [updateStatus, setUpdateStatus] = useState<{ status: string; message?: string }>({
    status: 'idle',
  });
  const [screen, setScreen] = useState<Screen>('login');
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const syncFormsFromSettings = (cfg: any, options: { resetPassword?: boolean } = {}) => {
    if (!cfg) return;
    setSettings(cfg);
    setForm({
      baseDir: cfg.baseDir ?? '',
      autoLaunch: Boolean(cfg.autoLaunch),
      watchFiles: normalizeWatchFiles(cfg.watchFiles),
      autoUpdate: cfg.autoUpdate ?? true,
    });
    setLoginForm((prev) => ({
      ...prev,
      email: cfg.login?.email ?? prev.email,
      remember: Boolean(cfg.login?.remember),
      password: options.resetPassword ? '' : prev.password,
    }));
  };

  const formatErrorMessage = (error: any): string => {
    if (!error) return 'Unknown error';
    const msg = error?.message || String(error);
    const match = msg.match(/Error invoking remote method '.*?': Error: (.*)/);
    return match ? match[1] : msg;
  };

  useEffect(() => {
    window.sync.getVersion().then(setVersion).catch(() => setVersion('unknown'));
    window.sync.getStatus().then((s) => setStatus(s));
    window.sync.getHistory().then((hist) => setHistory(hist ?? []));
    window.sync.getSettings().then((cfg) => {
      if (cfg) {
        syncFormsFromSettings(cfg);
        if (cfg.apiToken || (cfg.login?.email && cfg.login?.remember)) {
          setIsSignedIn(true);
          setScreen('dashboard');
        }
      }
    });

    const offStatus = window.sync.onStatus((next) => setStatus(next));
    const offHistory = window.sync.onHistory((next) => setHistory(next ?? []));
    const offUpdate = window.sync.onUpdateStatus((payload) => setUpdateStatus(payload));
    return () => {
      offStatus();
      offHistory();
      offUpdate();
    };
  }, []);

  const lastRunSummary = useMemo(() => {
    if (!status?.lastRun) return 'Never';
    const hash = status?.lastResult?.payloadHash
      ? status.lastResult.payloadHash.slice(0, 8)
      : '';
    return `${new Date(status.lastRun).toLocaleString(DATE_LOCALE)}`;
  }, [status]);

  const handlePause = () => window.sync.pause();
  const handleResume = () => window.sync.resume();
  const handleTrigger = () => window.sync.trigger('manual trigger');

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const pickBaseDir = async () => {
    const selection = await window.sync.pickPath({
      properties: ['openDirectory'],
      title: 'Select timetable folder',
      defaultPath: form.baseDir || undefined,
    });
    if (selection) {
      setForm((prev) => ({ ...prev, baseDir: selection }));
    }
  };

  const pickWatchFile = async (index: number) => {
    const selection = await window.sync.pickPath({
      properties: ['openFile'],
      title: 'Select timetabling file',
      defaultPath: form.watchFiles[index] || form.baseDir,
    });
    if (selection) {
      handleWatchFileChange(index, selection);
    }
  };

  const handleWatchFileChange = (index: number, value: string) => {
    setForm((prev) => {
      const next = normalizeWatchFiles(prev.watchFiles);
      next[index] = value;
      return { ...prev, watchFiles: next };
    });
  };

  const handleLoginInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = event.target;
    setLoginForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const watchFiles = form.watchFiles
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      const updated = await window.sync.updateSettings({
        baseDir: form.baseDir,
        autoLaunch: form.autoLaunch,
        watchFiles,
        autoUpdate: form.autoUpdate,
      });
      if (updated) {
        syncFormsFromSettings(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleLogin = async () => {
    setLoginStatus({ state: 'pending' });
    try {
      const result = await window.sync.login({
        email: loginForm.email,
        password: loginForm.password,
        remember: loginForm.remember,
      });
      if (result?.settings) {
        syncFormsFromSettings(result.settings, { resetPassword: true });
      } else {
        setLoginForm((prev) => ({ ...prev, password: '' }));
      }
      setLoginStatus({ state: 'success', message: 'Signed in successfully.' });
      setSignOutError(null);
      setIsSignedIn(true);
      setScreen('dashboard');
    } catch (error: any) {
      setLoginStatus({
        state: 'error',
        message: formatErrorMessage(error) || 'Login failed',
      });
    }
  };

  const handleLogout = async () => {
    setSignOutPending(true);
    setSignOutError(null);
    try {
      const updated = await window.sync.logout();
      if (updated) {
        syncFormsFromSettings(updated, { resetPassword: true });
      } else {
        setLoginForm((prev) => ({
          ...prev,
          password: '',
          remember: false,
        }));
      }
      setIsSignedIn(false);
      setScreen('login');
      setStatus(null);
      setLoginStatus({
        state: 'success',
        message: 'Signed out. Please sign in again.',
      });
    } catch (error: any) {
      setSignOutError(formatErrorMessage(error) || 'Sign out failed');
    } finally {
      setSignOutPending(false);
    }
  };

  const handleCheckUpdates = () => {
    setUpdateStatus({ status: 'checking' });
    window.sync.checkForUpdates();
  };

  const handleInstallUpdate = () => {
    if (updateStatus.status === 'available') {
      window.sync.installUpdate();
    }
  };

  const currentState = status?.state ?? 'Unknown';

  const getStatusLabel = (value?: string) => {
    switch (value) {
      case 'success':
        return 'Uploaded';
      case 'skipped':
        return 'Skipped';
      case 'error':
        return 'Error';
      case 'syncing':
        return 'Syncing';
      default:
        return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Unknown';
    }
  };

  const getHistoryNote = (entry: HistoryEntry) => {
    if (entry.status === 'skipped') {
      return entry.skippedReason || entry.message || 'No changes detected; identical payload.';
    }
    if (entry.status === 'success') {
      return entry.message || 'Upload accepted and queued for processing.';
    }
    if (entry.status === 'error') {
      return entry.message || 'Sync failed. Check the desktop logs for details.';
    }
    return entry.message || '';
  };

  const groupedHistory = useMemo(() => {
    const buckets: Record<string, HistoryEntry[]> = {};
    history.forEach((entry) => {
      const date = new Date(entry.timestamp).toLocaleDateString(DATE_LOCALE, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      if (!buckets[date]) buckets[date] = [];
      buckets[date].push(entry);
    });
    const ordered = Object.entries(buckets)
      .map(([date, entries]) => ({
        date,
        entries: entries.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        ),
      }))
      .sort(
        (a, b) =>
          new Date(b.entries[0]?.timestamp ?? 0).getTime() -
          new Date(a.entries[0]?.timestamp ?? 0).getTime()
      );
    const flattened: { date: string; entry: HistoryEntry }[] = [];
    ordered.forEach((group) => {
      group.entries.forEach((entry) => flattened.push({ date: group.date, entry }));
    });
    const limited = flattened.slice(0, 5);
    const regrouped: Record<string, HistoryEntry[]> = {};
    limited.forEach(({ date, entry }) => {
      if (!regrouped[date]) regrouped[date] = [];
      regrouped[date].push(entry);
    });
    return Object.entries(regrouped).map(([date, entries]) => ({
      date,
      entries,
    }));
  }, [history]);

  const banner = useMemo(() => {
    if (signOutError) return { type: 'error', text: signOutError };
    if (!isSignedIn && loginStatus.state === 'error' && loginStatus.message) {
      return { type: 'error', text: loginStatus.message };
    }
    if (status?.lastResult?.status === 'error') {
      return {
        type: 'error',
        text: status.lastResult?.message || 'Last sync failed. Please review the logs.',
      };
    }
    if (updateStatus.message && updateStatus.status !== 'idle') {
      return { type: 'info', text: updateStatus.message };
    }
    if (status?.lastResult?.status === 'success' && status.lastResult?.message) {
      return { type: 'success', text: status.lastResult.message };
    }
    return null;
  }, [
    isSignedIn,
    loginStatus.message,
    loginStatus.state,
    signOutError,
    status?.lastResult,
    updateStatus.message,
    updateStatus.status,
  ]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Innersync Desktop</h1>
          <p className="subtitle">Automated timetable sync & watcher control</p>
        </div>
        <div className="badge">v{version}</div>
      </header>
      {banner && <div className={`banner banner-${banner.type}`}>{banner.text}</div>}

      {isSignedIn && (
        <nav className="top-nav">
          <div className="nav-group">
            <button
              className={screen === 'dashboard' ? 'nav-active' : ''}
              onClick={() => setScreen('dashboard')}
              disabled={screen === 'dashboard'}
            >
              Dashboard
            </button>
            <button
              className={screen === 'settings' ? 'nav-active' : ''}
              onClick={() => setScreen('settings')}
              disabled={screen === 'settings'}
            >
              Settings
            </button>
          </div>
          <div className="nav-group">
            <button className="ghost" onClick={handleLogout} disabled={signOutPending}>
              {signOutPending ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </nav>
      )}
      {signOutError && <p className="alert error">{signOutError}</p>}

      <main className={`app-main ${!isSignedIn ? 'auth-only' : ''}`}>
        {isSignedIn && screen === 'dashboard' && (
          <div className="surface-grid">
            <section className="panel">
              <h2>Watcher Status</h2>
              <div className="status-grid">
                <div>
                  <span className="label">State</span>
                  <strong className={`state state-${currentState}`}>{currentState}</strong>
                </div>
                <div>
                  <span className="label">Paused</span>
                  <strong>{status?.paused ? 'Yes' : 'No'}</strong>
                </div>
                <div>
                  <span className="label">Last run</span>
                  <strong>{lastRunSummary}</strong>
                </div>
                <div>
                  <span className="label">Last result</span>
                  <strong>
                    {status?.lastResult?.status
                      ? getStatusLabel(status.lastResult.status)
                      : '—'}
                  </strong>
                </div>
              </div>
              <div className="actions toolbar">
                <button className="button-primary" onClick={handleTrigger}>
                  Sync Now
                </button>
                {status?.paused ? (
                  <button className="button-secondary" onClick={handleResume}>
                    Resume
                  </button>
                ) : (
                  <button className="button-secondary" onClick={handlePause}>
                    Pause
                  </button>
                )}
              </div>
            </section>

            <section className="panel">
              <h2>Recent History</h2>
              {groupedHistory.length === 0 && <p className="hint">No history yet.</p>}
              <div className="history-groups">
                {groupedHistory.map((group) => (
                  <div className="history-group" key={group.date}>
                    <div className="history-date">{group.date}</div>
                    <ul className="history-list">
                      {group.entries.slice(0, 4).map((entry) => {
                        const note = getHistoryNote(entry);
                        return (
                          <li
                            className="history-item"
                            key={`${entry.timestamp}-${entry.payloadHash ?? entry.reason}`}
                          >
                          <div className="history-header">
                            <span className={`pill pill-${entry.status}`}>
                              {getStatusLabel(entry.status)}
                            </span>
                            <span className="history-timestamp">
                              {new Date(entry.timestamp).toLocaleTimeString(DATE_LOCALE)}
                            </span>
                          </div>
                            <div className="history-body">
                              <div className="history-reason">{entry.reason}</div>
                              {note && <div className="history-note">{note}</div>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {isSignedIn && screen === 'settings' && (
          <div className="surface-grid settings-grid">
            <section className="panel">
              <h2>General Settings</h2>
              <div className="form-grid">
                <label>
                  Base Folder
                  <div className="input-row">
                    <input
                      type="text"
                      name="baseDir"
                      value={form.baseDir}
                      onChange={handleInputChange}
                      placeholder="Network share path"
                    />
                <button type="button" className="ghost" onClick={pickBaseDir}>
                  Browse…
                    </button>
                  </div>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    name="autoLaunch"
                    checked={form.autoLaunch}
                    onChange={handleInputChange}
                  />
                  Launch on Startup
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    name="autoUpdate"
                    checked={form.autoUpdate}
                    onChange={handleInputChange}
                  />
                  Check for Updates Automatically
                </label>
              </div>
              <div className="actions">
                <button className="button-primary" onClick={handleSaveSettings} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
              <div className="updates-block">
                <h3>Updates</h3>
                <p className="settings-hint">Keep the desktop agent on the latest release.</p>
                <div className="actions">
                  <button type="button" className="button-secondary" onClick={handleCheckUpdates}>
                    Check Now
                  </button>
                  <button
                    type="button"
                    className="button-primary"
                    onClick={handleInstallUpdate}
                    disabled={updateStatus.status !== 'available'}
                  >
                    Install Update
                  </button>
                </div>
                <p className="settings-hint">
                  Status: {updateStatus.status}
                  {updateStatus.message ? ` – ${updateStatus.message}` : ''}
                </p>
              </div>
            </section>

            <section className="panel file-panel">
              <h2>Watched Files</h2>
              <p className="hint">Master timetable and Year 7–12 exports.</p>
              <ul className="watch-list">
                {WATCH_LABELS.map((label, index) => (
                  <li key={`${label}-${index}`}>
                    <div className="watch-row">
                      <div className="watch-name">{label}</div>
                      <div className="watch-input">
                        <input
                          type="text"
                          value={form.watchFiles[index] ?? ''}
                          onChange={(event) => handleWatchFileChange(index, event.target.value)}
                          placeholder="Select file…"
                        />
                        <button type="button" className="ghost" onClick={() => pickWatchFile(index)}>
                          Browse…
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setForm((prev) => ({ ...prev, watchFiles: [...EMPTY_WATCH_FILES] }))}
                >
                    Clear All
                </button>
                <button className="button-primary" onClick={handleSaveSettings} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
              <p className="settings-hint">
                Generated CSV files are stored inside the app data folder automatically and are not
                user accessible.
              </p>
            </section>
          </div>
        )}

        {!isSignedIn && screen === 'login' && (
          <section className="panel auth-card">
            <div className="auth-brand">
              <h2>Sign in</h2>
              <p className="subtitle">Connect to innersync.com.au</p>
            </div>
            <div className="form-grid">
              <label>
                Email
                <input
                  type="text"
                  name="email"
                  value={loginForm.email}
                  onChange={handleLoginInputChange}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  name="password"
                  value={loginForm.password}
                  onChange={handleLoginInputChange}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  name="remember"
                  checked={loginForm.remember}
                  onChange={handleLoginInputChange}
                />
                Remember Password for Auto Refresh
              </label>
            </div>
            <div className="actions">
              <button
                className="button-primary"
                onClick={handleLogin}
                disabled={loginStatus.state === 'pending'}
              >
                {loginStatus.state === 'pending' ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
