import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Film, Music, Image as ImgIcon, Archive,
  FileText, Code2, File, Copy, Check, Link2,
  ShieldCheck, Activity, AlertCircle, X, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const BACKEND_URL = 'http://localhost:6467';

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

// ─── Animated status messages ─────────────────────────────────────────────────
const STATUS_MSGS = [
  '连接 DHT 网络...',
  '搜索 tracker 节点...',
  '等待 peer 响应...',
  '获取元数据中...',
  '努力搜寻中，请稍候...',
  '快要找到了...',
];

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [magnet, setMagnet]     = useState('');
  const [parsing, setParsing]   = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState(null);
  const [statusIdx, setStatus]  = useState(0);
  const [stats, setStats]       = useState(null);
  const [copied, setCopied]     = useState(false);
  const [copiedMag, setCopiedMag] = useState(false);

  // Admin
  const [isAdmin, setIsAdmin]         = useState(false);
  const [adminPass, setAdminPass]     = useState('');
  const [honeypot, setHoneypot]       = useState('');
  const [adminStats, setAdminStats]   = useState([]);
  const [adminTrackers, setAdminTrackers] = useState([]);
  const [adminSettings, setAdminSettings] = useState({});
  const [cleaning, setCleaning]       = useState(false);

  // Cycle status messages while parsing
  useEffect(() => {
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
      // Update URL so this result is shareable / bookmark-able
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
    setCopiedMag(false);

    // Tier 1: DB cache (instant)
    if (hash) {
      try {
        const res = await fetch(`${BACKEND_URL}/api/parse/cache?hash=${hash}`);
        if (res.ok) { handleSuccess(await res.json()); return; }
      } catch (_) {}
    }

    // Tier 2: backend DHT parse
    try {
      const res = await fetch(`${BACKEND_URL}/api/parse?magnet=${encodeURIComponent(clean)}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Backend failed');
      }
      handleSuccess(await res.json());
    } catch (err) {
      setParsing(false);
      setError('解析失败：该磁力链接暂无活跃节点，请稍后重试。');
    }
  }, [handleSuccess]);

  // URL param auto-search on mount
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

  const copyHash = async () => {
    if (!result?.infoHash) return;
    await navigator.clipboard.writeText(result.infoHash).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyMagnet = async () => {
    if (!result?.infoHash) return;
    await navigator.clipboard.writeText(`magnet:?xt=urn:btih:${result.infoHash}`).catch(() => {});
    setCopiedMag(true);
    setTimeout(() => setCopiedMag(false), 2000);
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
  };

  // ── Admin helpers ────────────────────────────────────────────────────────
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
        body: JSON.stringify({ username: honeypot, password: adminPass }),
      });
      if (res.ok) {
        const d = await res.json();
        localStorage.setItem('adminToken', d.token);
        setIsAdmin(true);
        fetchAdminData();
      } else alert('Access Denied');
    } catch (_) { alert('Login Error'); }
  };

  const saveSettings = async () => {
    const token = localStorage.getItem('adminToken');
    await fetch(`${BACKEND_URL}/api/admin/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify(adminSettings),
    });
    alert('Settings saved.');
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
    if (!confirm('删除该 tracker？')) return;
    const token = localStorage.getItem('adminToken');
    await fetch(`${BACKEND_URL}/api/admin/trackers/${id}`, {
      method: 'DELETE', headers: { 'X-Admin-Token': token },
    });
    fetchAdminData();
  };

  const cleanTrackers = async () => {
    if (!confirm('将并发检测所有 tracker 可达性，删除无响应的。耗时较长，确定继续？')) return;
    const token = localStorage.getItem('adminToken');
    setCleaning(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/trackers/clean`, {
        method: 'POST', headers: { 'X-Admin-Token': token },
      });
      const d = await res.json();
      if (res.ok) { alert(`清理完成，删除了 ${d.removed} 个无效 tracker`); fetchAdminData(); }
      else alert('清理失败: ' + d.error);
    } finally { setCleaning(false); }
  };

  // ── Admin page ────────────────────────────────────────────────────────────
  const path = window.location.pathname.replace(/\/$/, '');
  const isHoneypot = path === '/admin';
  const isRealAdmin = path === '/10w_gl888';

  if (isHoneypot || isRealAdmin) {
    return (
      <div className="admin-container">
        <header className="admin-header">
          <h1>System Management</h1>
          <a href="/" className="btn-back">← 返回</a>
        </header>

        {!isAdmin ? (
          <div className="login-card">
            <h2>管理员登录</h2>
            <form onSubmit={handleAdminLogin} className="login-form">
              {isHoneypot && (
                <input type="text" placeholder="Email or phone"
                  value={honeypot} onChange={e => setHoneypot(e.target.value)}
                  className="field-input" />
              )}
              <input type="password" placeholder="密码"
                value={adminPass} onChange={e => setAdminPass(e.target.value)}
                className="field-input" />
              <button type="submit" className="btn-primary">登录</button>
            </form>
          </div>
        ) : (
          <div className="admin-panels">
            {/* Stats */}
            <div className="panel-card">
              <h3><Activity size={14} /> 热门哈希</h3>
              <table className="data-table">
                <thead><tr><th>Hash</th><th>查询次数</th><th>最近查询</th></tr></thead>
                <tbody>
                  {adminStats.map((s, i) => (
                    <tr key={i}>
                      <td className="mono">{s.info_hash}</td>
                      <td>{s.query_count}</td>
                      <td className="muted">{s.last_query_time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Trackers */}
            <div className="panel-card">
              <div className="panel-header">
                <h3><ShieldCheck size={14} /> Tracker 管理</h3>
                <button className="btn-clean" onClick={cleanTrackers} disabled={cleaning}>
                  <RefreshCw size={13} className={cleaning ? 'spin' : ''} />
                  {cleaning ? '检测中...' : '一键清理'}
                </button>
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
                if (res.ok) { const d = await res.json(); ta.value = ''; fetchAdminData(); alert(`已添加 ${d.count} 条`); }
                else alert('添加失败');
              }} className="tracker-add-form">
                <textarea name="trackerUrl" rows={3} className="field-input mono-input"
                  placeholder={"支持批量粘贴，每行一个：\nudp://tracker.opentrackr.org:1337/announce\nwss://tracker.openwebtorrent.com"} />
                <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-end' }}>添加</button>
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

            {/* Settings */}
            <div className="panel-card">
              <h3>系统设置</h3>
              <div className="settings-form">
                <div className="field-group">
                  <label>管理后台路径</label>
                  <input type="text" className="field-input"
                    value={adminSettings.admin_path || ''}
                    onChange={e => setAdminSettings({ ...adminSettings, admin_path: e.target.value })} />
                </div>
                <div className="field-group">
                  <label>Tracker 同步源</label>
                  <input type="text" className="field-input"
                    value={adminSettings.tracker_sync_source || ''}
                    onChange={e => setAdminSettings({ ...adminSettings, tracker_sync_source: e.target.value })} />
                </div>
                <button className="btn-primary" onClick={saveSettings}>保存设置</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Main page ─────────────────────────────────────────────────────────────
  return (
    <div className="page-wrap">
      <main className="main-center">
        {/* Logo */}
        <motion.div className="brand"
          initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4 }}>
          <img src="/logo.png" alt="Magnet Search" className="brand-logo" />
        </motion.div>

        {/* Search */}
        <form onSubmit={e => { e.preventDefault(); doSearch(magnet); }} className="search-wrap">
          <div className={`search-box${parsing ? ' searching' : ''}`}>
            <Search className="search-ico" size={18} />
            <input
              type="text"
              className="search-input"
              placeholder="粘贴磁力链接 或 40位哈希值…"
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

          {/* Progress bar (seamlessly attached below search box) */}
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
              {parsing ? '解析中…' : '解析磁力'}
            </button>
          </div>
        </form>

        {/* Cycling status */}
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

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div className="error-box"
              initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Result */}
        <AnimatePresence>
          {result && (
            <motion.div className="result-wrap"
              initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: .38, ease: [.16, 1, .3, 1] }}>

              {/* Header */}
              <div className="result-header">
                <h2 className="result-name">{result.name}</h2>
                <div className="hash-row">
                  <code className="hash-text">{result.infoHash}</code>
                  <button className="icon-btn" onClick={copyHash} title="复制哈希">
                    {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                  </button>
                  <button className="icon-btn" onClick={copyMagnet} title="复制磁力链接">
                    {copiedMag ? <Check size={14} color="#10b981" /> : <Link2 size={14} />}
                  </button>
                </div>
                <div className="result-badges">
                  <span className="badge">{result.files?.length ?? 1} 个文件</span>
                  <span className="badge">{formatSize(result.totalSize)}</span>
                  {stats && <span className="badge accent">已查询 {stats.query_count} 次</span>}
                </div>
              </div>

              {/* File list */}
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
        <span>隐私保护</span>
        <span>·</span>
        <a href="/10w_gl888">管理</a>
      </footer>
    </div>
  );
}

