import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Film, Music, Image as ImgIcon, Archive,
  FileText, Code2, File, Check, Link2, Download,
  ShieldCheck, Activity, AlertCircle, X, RefreshCw, Globe, Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import translations from './i18n';

const BACKEND_URL = '';

// ─── File type icon + color map ───────────────────────────────────────────────
const FILE_TYPES = [
  { exts: ['mp4','mkv','avi','mov','wmv','flv','webm','m4v','ts','rmvb'], icon: Film,     color: '#ef4444' },
  { exts: ['mp3','flac','aac','wav','ogg','m4a','opus','wma','ape'],       icon: Music,    color: '#8b5cf6' },
  { exts: ['jpg','jpeg','png','gif','webp','bmp','svg','tiff','heic'],      icon: ImgIcon,  color: '#3b82f6' },
  { exts: ['zip','rar','7z','tar','gz','bz2','xz','zst','iso'],             icon: Archive,  color: '#f59e0b' },
  { exts: ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','epub'], icon: FileText, color: '#10b981' },
  { exts: ['js','ts','jsx','tsx','py','go','java','cpp','c','h','rs','php','html','css','json'], icon: Code2, color: '#06b6d4' },
];
const getFileType = (filename) => {
  const ext = (filename || '').split('.').pop().toLowerCase();
  return FILE_TYPES.find(t => t.exts.includes(ext)) || { icon: File, color: '#94a3b8' };
};

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang]         = useState('en');
  const [magnet, setMagnet]     = useState('');
  const [parsing, setParsing]   = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState(null);
  const [statusIdx, setStatus]  = useState(0);
  const [stats, setStats]       = useState(null);
  const [copied, setCopied]     = useState(false);

  // Admin
  const [isAdmin, setIsAdmin]         = useState(false);
  const [adminPass, setAdminPass]     = useState('');
  const [adminUser, setAdminUser]     = useState('admin');
  const [honeypot, setHoneypot]       = useState('');
  const [adminTab, setAdminTab]       = useState('stats');
  const [adminStats, setAdminStats]   = useState([]);
  const [adminTrackers, setAdminTrackers] = useState([]);
  const [adminSettings, setAdminSettings] = useState({});
  const [cleaning, setCleaning]       = useState(false);
  const [pwForm, setPwForm]           = useState({ old: '', newUser: '', newPass: '', confirm: '' });

  const t = (key) => translations[lang]?.[key] || translations['en'][key] || key;

  const STATUS_MSGS = [
    t('stageCache'),
    t('stage1'),
    t('stage2'),
    t('stage3'),
    t('stage4'),
    t('stage5'),
  ];

  // Cycle status messages while parsing
  useEffect(() => {
    // 1. Language Detection
    const userLang = navigator.language || navigator.userLanguage;
    let detected = 'en';
    if (userLang.startsWith('zh')) {
      detected = (userLang.toLowerCase().includes('tw') || userLang.toLowerCase().includes('hk') || userLang.toLowerCase().includes('mo')) ? 'zh-TW' : 'zh-CN';
    } else if (userLang.startsWith('ja')) detected = 'ja';
    else if (userLang.startsWith('ko')) detected = 'ko';
    else if (userLang.startsWith('es')) detected = 'es';
    setLang(detected);
    document.documentElement.lang = detected;

    // 2. Cycle messages
    if (!parsing) { setStatus(0); return; }
    const iv = setInterval(() => setStatus(i => (i + 1) % STATUS_MSGS.length), 2800);
    return () => clearInterval(iv);
  }, [parsing]);

  const extractHash = (input) => {
    const bare = input.trim();
    if (/^[0-9a-fA-F]{40}$/i.test(bare)) return bare.toLowerCase();
    const m = bare.match(/btih:([0-9a-fA-F]{40})/i);
    return m ? m[1].toLowerCase() : null;
  };

  const handleSuccess = useCallback((data) => {
    setParsing(false);
    setResult(data);
    setError(null);
    if (data.infoHash) {
      fetchStats(data.infoHash);
      const p = new URLSearchParams(window.location.search);
      p.set('hash', data.infoHash);
      window.history.replaceState(null, '', `?${p}`);
    }
  }, []);

  const fetchStats = async (hash) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/stats/${hash}`);
      if (res.ok) setStats(await res.json());
    } catch (_) {}
  };

  const doSearch = useCallback(async (input) => {
    const clean = input.trim();
    if (!clean) return;
    const hash = extractHash(clean);
    setParsing(true);
    setResult(null);
    setError(null);
    setStats(null);
    setCopied(false);

    if (hash) {
      try {
        const res = await fetch(`${BACKEND_URL}/api/parse/cache?hash=${hash}`);
        if (res.ok) { handleSuccess(await res.json()); return; }
      } catch (_) {}
    }

    const magnetURI = hash && !clean.startsWith('magnet:')
      ? `magnet:?xt=urn:btih:${hash}`
      : clean;
    try {
      const res = await fetch(`${BACKEND_URL}/api/parse?magnet=${encodeURIComponent(magnetURI)}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Backend failed');
      }
      handleSuccess(await res.json());
    } catch (err) {
      setParsing(false);
      setError(t('errorParse'));
    }
  }, [handleSuccess]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const h = p.get('hash') || p.get('h');
    const m = p.get('magnet') || p.get('m');
    if (h && /^[0-9a-fA-F]{40}$/i.test(h.trim())) {
      const v = h.trim().toLowerCase();
      setMagnet(v);
      doSearch(v);
    } else if (m) {
      const v = decodeURIComponent(m);
      setMagnet(v);
      doSearch(v);
    }
    const token = localStorage.getItem('adminToken');
    if (token) { setIsAdmin(true); fetchAdminData(); }
  }, []);

  const copyMagnet = async () => {
    if (!result?.infoHash) return;
    await navigator.clipboard.writeText(`magnet:?xt=urn:btih:${result.infoHash}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadTorrent = () => {
    if (!result?.infoHash) return;
    // Use backend HTTP endpoint — works in TG/WeChat in-app browsers (no blob:// restriction)
    if (result.torrentBase64 || result.torrentFile) {
      // If we have data locally (WebTorrent stage 1 result), fall back to blob for speed
      let blob;
      if (result.torrentFile) {
        blob = new Blob([result.torrentFile], { type: 'application/x-bittorrent' });
      } else {
        const bin = atob(result.torrentBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: 'application/x-bittorrent' });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${result.name || result.infoHash}.torrent`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      // Fallback: direct HTTP download from backend (works in all in-app browsers)
      window.location.href = `/api/torrent/${result.infoHash}`;
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
  };

  const fetchAdminData = async () => {
    const token = localStorage.getItem('adminToken');
    try {
      const [sR, tR, setR] = await Promise.all([
        fetch(`${BACKEND_URL}/api/admin/stats`,    { headers: { 'X-Admin-Token': token } }),
        fetch(`${BACKEND_URL}/api/admin/trackers`, { headers: { 'X-Admin-Token': token } }),
        fetch(`${BACKEND_URL}/api/admin/settings`, { headers: { 'X-Admin-Token': token } }),
      ]);
      if (sR.ok)   setAdminStats(await sR.json());
      if (tR.ok)   setAdminTrackers(await tR.json());
      if (setR.ok) setAdminSettings(await setR.json());
    } catch (_) {}
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trap: honeypot, username: adminUser, password: adminPass }),
      });
      if (res.ok) {
        const d = await res.json();
        localStorage.setItem('adminToken', d.token);
        setIsAdmin(true);
        fetchAdminData();
      } else alert(t('loginFail'));
    } catch (_) { alert('Login Error'); }
  };

  const saveSettings = async () => {
    const token = localStorage.getItem('adminToken');
    await fetch(`${BACKEND_URL}/api/admin/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify(adminSettings),
    });
    alert(t('saved'));
    fetchAdminData();
  };

  const toggleTracker = async (id, current) => {
    const token = localStorage.getItem('adminToken');
    await fetch(`${BACKEND_URL}/api/admin/trackers/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ id, enabled: current === 1 ? 0 : 1 }),
    });
    fetchAdminData();
  };

  const deleteTracker = async (id) => {
    if (!confirm(t('confirmDel'))) return;
    const token = localStorage.getItem('adminToken');
    await fetch(`${BACKEND_URL}/api/admin/trackers/${id}`, {
      method: 'DELETE', headers: { 'X-Admin-Token': token },
    });
    fetchAdminData();
  };

  const cleanTrackers = async () => {
    if (!confirm(t('confirmClean'))) return;
    const token = localStorage.getItem('adminToken');
    setCleaning(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/trackers/clean`, {
        method: 'POST', headers: { 'X-Admin-Token': token },
      });
      const d = await res.json();
      if (res.ok) { alert(t('cleanDone').replace('{n}', d.removed)); fetchAdminData(); }
      else alert(t('cleanFail') + ': ' + d.error);
    } finally { setCleaning(false); }
  };

  const exportTrackers = () => {
    const token = localStorage.getItem('adminToken');
    const a = document.createElement('a');
    fetch(`${BACKEND_URL}/api/admin/trackers/export`, { headers: { 'X-Admin-Token': token } })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        a.href = url; a.download = 'trackers.txt';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
      });
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pwForm.newPass !== pwForm.confirm) { alert(t('pwMismatch')); return; }
    if (pwForm.newPass.length < 6) { alert(t('pwShort')); return; }
    const token = localStorage.getItem('adminToken');
    const res = await fetch(`${BACKEND_URL}/api/admin/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ old_password: pwForm.old, new_username: pwForm.newUser, new_password: pwForm.newPass }),
    });
    const d = await res.json();
    if (res.ok) {
      alert(d.message);
      localStorage.setItem('adminToken', d.new_token);
      setPwForm({ old: '', newUser: '', newPass: '', confirm: '' });
      fetchAdminData();
    } else alert(d.error || 'Failed');
  };

  const path = window.location.pathname.replace(/\/$/, '');
  const isHoneypot = path === '/admin';
  const adminPath = '/' + (window.__ADMIN_PATH__ || '10w_gl888');
  const isRealAdmin = path === adminPath;

  if (isHoneypot || isRealAdmin) {
    return (
      <div className="admin-container">
        <header className="admin-header">
          <h1>{t('adminTitle')}</h1>
          <a href="/" className="btn-back">← {t('back')}</a>
        </header>

        {!isAdmin ? (
          <div className="login-card">
            <h2>{t('adminLogin')}</h2>
            <form onSubmit={handleAdminLogin} className="login-form">
              {isHoneypot && (
                <input type="text" placeholder="Email or phone"
                  value={honeypot} onChange={e => setHoneypot(e.target.value)}
                  className="field-input" />
              )}
              {!isHoneypot && (
                <input type="text" placeholder={t('username')}
                  value={adminUser} onChange={e => setAdminUser(e.target.value)}
                  className="field-input" autoComplete="username" />
              )}
              <input type="password" placeholder={t('password')}
                value={adminPass} onChange={e => setAdminPass(e.target.value)}
                className="field-input" autoComplete="current-password" />
              <button type="submit" className="btn-primary">{t('loginBtn')}</button>
            </form>
          </div>
        ) : (
          <div>
            <div className="admin-tabs">
              {[
                { key: 'stats',    label: t('tabStats') },
                { key: 'trackers', label: t('tabTrackers') },
                { key: 'settings', label: t('tabSettings') },
              ].map(t => (
                <button key={t.key}
                  className={`admin-tab${adminTab === t.key ? ' active' : ''}`}
                  onClick={() => setAdminTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>

            {adminTab === 'stats' && (
              <div className="panel-card">
                <h3><Activity size={14} /> {t('hotHashes')} <span className="field-badge">{t('clickDetail')}</span></h3>
                <table className="data-table">
                  <thead><tr><th>Hash</th><th>{t('queries')}</th><th>{t('lastTime')}</th></tr></thead>
                  <tbody>
                    {adminStats.map((s, i) => (
                      <tr key={i} className="hash-link-row"
                        onClick={() => window.open(`/?hash=${s.info_hash}`, '_blank')}>
                        <td className="mono">{s.info_hash}</td>
                        <td>{s.query_count}</td>
                        <td className="muted">{s.last_query_time}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {adminTab === 'trackers' && (
              <div className="admin-panels">
                <div className="panel-card">
                  <div className="panel-header">
                    <h3><ShieldCheck size={14} /> {t('trackerMgmt')}
                      <span className="field-badge" style={{ marginLeft: 8 }}>
                        {adminSettings.tracker_count || 0} / {adminSettings.tracker_max_count || 200}
                      </span>
                    </h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-clean" onClick={exportTrackers} title={t('export')}>
                        ↓ {t('export')}
                      </button>
                      <button className="btn-clean" onClick={cleanTrackers} disabled={cleaning}>
                        <RefreshCw size={13} className={cleaning ? 'spin' : ''} />
                        {cleaning ? t('cleaning') : t('clean')}
                      </button>
                    </div>
                  </div>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    const ta = e.target.elements.trackerUrl;
                    const url = ta.value.trim();
                    if (!url) return;
                    const token = localStorage.getItem('adminToken');
                    const res = await fetch(`${BACKEND_URL}/api/admin/trackers/add`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
                      body: JSON.stringify({ url }),
                    });
                    if (res.ok) { const d = await res.json(); ta.value = ''; fetchAdminData(); alert(t('added').replace('{n}', d.count)); }
                    else alert(t('addFail'));
                  }} className="tracker-add-form">
                    <textarea name="trackerUrl" rows={3} className="field-input mono-input"
                      placeholder={t('placeholderTrackers')} />
                    <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-end' }}>{t('add')}</button>
                  </form>
                  <div className="tracker-list">
                    {adminTrackers.map((t, i) => (
                      <div key={i} className="tracker-row">
                        <span className="tracker-url">{t.url}</span>
                        <div className="tracker-actions">
                          <button className={`status-btn ${t.enabled ? 'enabled' : 'disabled'}`}
                            onClick={() => toggleTracker(t.id, t.enabled)}>
                            {t.enabled ? 'ON' : 'OFF'}
                          </button>
                          <button className="del-btn" onClick={() => deleteTracker(t.id)}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {adminTab === 'settings' && (
              <div className="admin-panels">
                <div className="panel-card">
                  <h3>{t('sysSettings')}</h3>
                  <div className="settings-form">
                    <div className="field-group">
                      <label>{t('adminPath')}</label>
                      <input type="text" className="field-input"
                        value={adminSettings.admin_path || ''}
                        onChange={e => setAdminSettings({ ...adminSettings, admin_path: e.target.value })} />
                    </div>
                    <div className="field-group">
                      <label>{t('syncSource')}</label>
                      <textarea rows={5} className="field-input mono-input"
                        value={adminSettings.tracker_sync_source || ''}
                        onChange={e => setAdminSettings({ ...adminSettings, tracker_sync_source: e.target.value })} />
                    </div>
                    <div className="field-group">
                      <label>{t('maxTrackers')}</label>
                      <input type="number" min="10" max="2000" className="field-input" style={{ width: 90 }}
                        value={adminSettings.tracker_max_count || '200'}
                        onChange={e => setAdminSettings({ ...adminSettings, tracker_max_count: e.target.value })} />
                    </div>
                    <div className="field-group">
                      <label>{t('concurrency')}</label>
                      <input type="number" min="1" max="200" className="field-input" style={{ width: 90 }}
                        value={adminSettings.parse_concurrency || '15'}
                        onChange={e => setAdminSettings({ ...adminSettings, parse_concurrency: e.target.value })} />
                    </div>
                    <button className="btn-primary" onClick={saveSettings}>{t('save')}</button>
                  </div>
                </div>

                <div className="panel-card">
                  <h3>{t('changeCredentials')}</h3>
                  <form onSubmit={changePassword} className="settings-form">
                    <div className="field-group">
                      <label>{t('oldPass')}</label>
                      <input type="password" className="field-input" value={pwForm.old}
                        onChange={e => setPwForm({ ...pwForm, old: e.target.value })} />
                    </div>
                    <div className="field-group">
                      <label>{t('newUsername')}</label>
                      <input type="text" className="field-input" value={pwForm.newUser}
                        onChange={e => setPwForm({ ...pwForm, newUser: e.target.value })} />
                    </div>
                    <div className="field-group">
                      <label>{t('newPass')}</label>
                      <input type="password" className="field-input" value={pwForm.newPass}
                        onChange={e => setPwForm({ ...pwForm, newPass: e.target.value })} />
                    </div>
                    <div className="field-group">
                      <label>{t('confirmPass')}</label>
                      <input type="password" className="field-input" value={pwForm.confirm}
                        onChange={e => setPwForm({ ...pwForm, confirm: e.target.value })} />
                    </div>
                    <button type="submit" className="btn-primary">{t('update')}</button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <main className="main-center">
        <motion.div className="brand"
          initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4 }}>
          <img src="/logo.png" alt="Magnet Search" className="brand-logo" />
          <h1 className="brand-title">{t('title')}</h1>
          <p className="brand-subtitle">{t('subtitle')}</p>
        </motion.div>

        <form onSubmit={e => { e.preventDefault(); doSearch(magnet); }} className="search-wrap">
          <div className={`search-box${parsing ? ' searching' : ''}`}>
            <Search className="search-ico" size={18} />
            <input
              type="text"
              className="search-input"
              placeholder={t('placeholder')}
              value={magnet}
              onChange={e => { setMagnet(e.target.value); setError(null); }}
              disabled={parsing}
              autoFocus
            />
            {magnet && !parsing && (
              <button type="button" className="clear-btn"
                onClick={() => { setMagnet(''); setResult(null); setError(null); setStats(null); window.history.replaceState(null, '', '/'); }}>
                <X size={15} />
              </button>
            )}
          </div>

          <AnimatePresence>
            {parsing && (
              <motion.div className="progress-track"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="progress-bar" />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="search-actions">
            <button type="submit" className="btn-search" disabled={parsing || !magnet.trim()}>
              {parsing ? t('btnParsing') : t('btnParse')}
            </button>
          </div>
          <p className="privacy-hint">{t('privacyHint')}</p>
        </form>

        <AnimatePresence mode="wait">
          {parsing && (
            <motion.p key={statusIdx} className="status-msg"
              initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }} transition={{ duration: .25 }}>
              <span className="status-dot" />
              {STATUS_MSGS[statusIdx]}
            </motion.p>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div className="error-box"
              initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {result && (
            <motion.div className="result-wrap"
              initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: .38, ease: [.16, 1, .3, 1] }}>

              <div className="result-header">
                <h2 className="result-name">{result.name}</h2>
                <div className="hash-row">
                  <code className="hash-text">{result.infoHash}</code>
                  <button className="icon-btn" onClick={copyMagnet} title={t('copyMagnet')}>
                    {copied ? <Check size={14} color="#10b981" /> : <Link2 size={14} />}
                  </button>
                </div>
                <div className="result-badges">
                  <span className="badge">{(result.files || []).length} {t('fileCount')}</span>
                  <span className="badge">{formatSize(result.totalSize)}</span>
                  <button className="btn-dl" onClick={downloadTorrent} title={t('downloadTorrent')}>
                    <Download size={13} />
                    {t('downloadTorrent')}
                  </button>
                </div>
              </div>

              <div className="file-list">
                {(result.files || []).map((file, i) => {
                  const ft = getFileType(file.path);
                  const Icon = ft.icon;
                  return (
                    <div key={i} className={`file-row ${i % 2 === 0 ? 'even' : 'odd'}`}>
                      <span className="file-icon" style={{ color: ft.color }}>
                        <Icon size={15} />
                      </span>
                      <span className="file-path" title={file.path}>{file.path}</span>
                      <span className="file-size">{formatSize(file.size)}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="site-footer">
        <span>&copy; 10W Magnet Parser - Privacy Focused</span>
        <button 
          onClick={() => {
            const languages = Object.keys(translations);
            const nextIdx = (languages.indexOf(lang) + 1) % languages.length;
            setLang(languages[nextIdx]);
          }}
          className="lang-toggle-btn"
          title="Switch Language"
        >
          <Globe size={14} />
          <span>{lang.toUpperCase()}</span>
        </button>
      </footer>
    </div>
  );
}

