import React, { useState, useEffect, useRef } from 'react';
import WebTorrent from 'webtorrent';
import { Search, FileText, Download, ShieldCheck, Activity, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const BACKEND_URL = 'http://localhost:6467';

function App() {
  const [magnet, setMagnet] = useState('');
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [stats, setStats] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminToken, setAdminToken] = useState(localStorage.getItem('adminToken') || '');
  const [adminStats, setAdminStats] = useState([]);
  const [adminTrackers, setAdminTrackers] = useState([]);
  const [adminSettings, setAdminSettings] = useState({});
  const [adminPass, setAdminPass] = useState('');
  const [honeypot, setHoneypot] = useState(''); // Honeypot field
  // Tracks the currently active parse client so it can be destroyed on unmount
  const activeClientRef = useRef(null);

  // Browser-only: reliable wss:// trackers hardcoded as baseline
  const WSS_TRACKERS = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.webtorrent.dev',
  ];

  useEffect(() => {
    // Sync additional wss:// trackers from backend
    const syncTrackers = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/trackers`);
        if (res.ok) {
          const data = await res.json();
          // Browser can only use wss:// trackers
          const wss = Array.isArray(data)
            ? data.filter(url => url.startsWith('wss://') || url.startsWith('ws://'))
            : [];
          window._syncedTrackers = wss;
          console.log('Backend provided', wss.length, 'wss trackers');
        }
      } catch (e) {
        window._syncedTrackers = [];
      }
    };
    syncTrackers();

    if (adminToken) {
      setIsAdmin(true);
      fetchAdminData();
    }
    return () => {
      // Clean up any in-progress parse on unmount
      if (activeClientRef.current) {
        try { activeClientRef.current.destroy(); } catch (e) {}
        activeClientRef.current = null;
      }
    };
  }, []);

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: honeypot, password: adminPass })
      });
      if (response.ok) {
        const data = await response.json();
        setAdminToken(data.token);
        localStorage.setItem('adminToken', data.token);
        setIsAdmin(true);
        fetchAdminData();
      } else {
        alert('Access Denied');
      }
    } catch (err) {
      alert('Login Error');
    }
  };

  const fetchAdminData = async () => {
    const token = localStorage.getItem('adminToken');
    try {
      const statsRes = await fetch(`${BACKEND_URL}/api/admin/stats`, {
        headers: { 'X-Admin-Token': token }
      });
      const trackersRes = await fetch(`${BACKEND_URL}/api/admin/trackers`, {
        headers: { 'X-Admin-Token': token }
      });
      const settingsRes = await fetch(`${BACKEND_URL}/api/admin/settings`, {
        headers: { 'X-Admin-Token': token }
      });
      if (statsRes.ok) setAdminStats(await statsRes.json());
      if (trackersRes.ok) setAdminTrackers(await trackersRes.json());
      if (settingsRes.ok) setAdminSettings(await settingsRes.json());
    } catch (err) {
      console.error('Admin fetch error:', err);
    }
  };

  const saveSettings = async () => {
    const token = localStorage.getItem('adminToken');
    await fetch(`${BACKEND_URL}/api/admin/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify(adminSettings)
    });
    alert('Settings saved. Refresh or update path manually.');
    fetchAdminData();
  };

  const toggleTracker = async (id, current) => {
    const token = localStorage.getItem('adminToken');
    await fetch(`${BACKEND_URL}/api/admin/trackers/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ id, enabled: current === 1 ? 0 : 1 })
    });
    fetchAdminData();
  };

  const deleteTracker = async (id) => {
    if (!confirm('Are you sure?')) return;
    const token = localStorage.getItem('adminToken');
    await fetch(`${BACKEND_URL}/api/admin/trackers/${id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': token }
    });
    fetchAdminData();
  };

  // Extract info hash from magnet URI or bare 40-char hex
  const extractInfoHash = (magnetURI) => {
    const bare = magnetURI.trim();
    if (/^[0-9a-fA-F]{40}$/i.test(bare)) return bare.toLowerCase();
    const m = bare.match(/btih:([0-9a-fA-F]{40})/i);
    return m ? m[1].toLowerCase() : null;
  };

  const handleParse = async (e) => {
    if (e) e.preventDefault();
    if (!magnet.trim()) return;

    const cleanMagnet = magnet.trim();
    const infoHash = extractInfoHash(cleanMagnet);
    setParsing(true);
    setResult(null);
    setError(null);

    // ── 第一级：服务器缓存（瞬间） ──
    if (infoHash) {
      try {
        setStatus('查询缓存...');
        const res = await fetch(`${BACKEND_URL}/api/parse/cache?hash=${infoHash}`);
        if (res.ok) {
          const data = await res.json();
          setStatus('');
          handleSuccess(data);
          return;
        }
      } catch (e) { /* 网络错误忽略，继续下一级 */ }
    }

    // ── 第二级：前端 P2P + 后端并行，前端礼让 3 秒先跑 ──
    // 若浏览器 3 秒内没消息，后端同步启动；谁先成功谁赢，避免死等 20s
    let settled = false;
    const settle = (data) => {
      if (settled) return;
      settled = true;
      handleSuccess(data);
    };

    setStatus('P2P 网络搜索中（浏览器直连）...');

    const frontendPromise = parseWithFrontend(cleanMagnet, 20000)
      .then(data => { settle(data); })
      .catch(err => console.log('Frontend P2P failed:', err));

    // 后端礼让 3 秒，给前端机会先赢
    const backendPromise = new Promise(resolve => setTimeout(resolve, 3000))
      .then(() => {
        if (settled) return;
        setStatus('服务器并行搜索中...');
        return parseWithBackend(cleanMagnet);
      })
      .then(data => { if (data) settle(data); })
      .catch(err => console.log('Backend parse failed:', err));

    await Promise.all([frontendPromise, backendPromise]);

    if (!settled) {
      setParsing(false);
      setStatus('');
      setError('解析失败：该磁力链接暂无活跃节点，请稍后重试。');
    }
  };

  const parseWithFrontend = (magnetURI, timeoutMs) => {
    return new Promise((resolve, reject) => {
      // Destroy any previous client to avoid stale state / duplicate errors
      if (activeClientRef.current) {
        try { activeClientRef.current.destroy(); } catch (e) {}
        activeClientRef.current = null;
      }

      const client = new WebTorrent();
      activeClientRef.current = client;
      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeClientRef.current = null;
        setTimeout(() => { try { client.destroy(); } catch (e) {} }, 300);
        resolve(result);
      };

      const fail = (reason) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeClientRef.current = null;
        setTimeout(() => { try { client.destroy(); } catch (e) {} }, 300);
        reject(reason);
      };

      // Normalize: accept bare 40-char hex hash
      let mag = magnetURI.trim();
      if (/^[0-9a-fA-F]{40}$/i.test(mag)) {
        mag = `magnet:?xt=urn:btih:${mag.toLowerCase()}`;
      }

      // Combine hardcoded + backend-synced wss trackers; deduplicate
      const trackers = [...new Set([
        ...WSS_TRACKERS,
        ...(window._syncedTrackers || []),
      ])];

      // Inject all trackers into the magnet URI
      trackers.forEach(tr => {
        const enc = encodeURIComponent(tr);
        if (!mag.includes(enc)) mag += `&tr=${enc}`;
      });

      const timer = setTimeout(() => fail('timeout'), timeoutMs);

      client.on('error', err => fail(err.message || String(err)));

      setStatus('P2P 网络搜索中（同步后端解析）...');

      // Pass trackers both via magnet URI and the announce option for maximum coverage
      client.add(mag, { announce: trackers }, (torrent) => {
        torrent.on('wire', () => {
          if (!settled) setStatus(`P2P 已发现 ${torrent.numPeers} 个节点，等待元数据...`);
        });

        const onMetadata = () => {
          finish({
            infoHash: torrent.infoHash,
            name: torrent.name,
            files: torrent.files.map(f => ({ path: f.path, size: f.length })),
            totalSize: torrent.length,
            torrentFile: torrent.torrentFile,
          });
        };

        // Metadata might already be available (cached / fast tracker response)
        if (torrent.files && torrent.files.length > 0) {
          onMetadata();
        } else {
          torrent.once('metadata', onMetadata);
        }
      });
    });
  };

  const parseWithBackend = async (magnetURI) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/parse?magnet=${encodeURIComponent(magnetURI)}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Backend failed');
      }
      const result = await response.json();
      return result;
    } catch (err) {
      throw err;
    }
  };

  const handleSuccess = (data) => {
    setParsing(false);
    setStatus('');
    setResult(data);
    if (data.infoHash) fetchStats(data.infoHash);
  };

  const fetchStats = async (hash) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/stats/${hash}`);
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Stats fetch error:', err);
    }
  };

  const downloadTorrent = () => {
    if (!result) return;
    
    let blob;
    if (result.torrentFile) {
      // From frontend parsing (Buffer)
      blob = new Blob([result.torrentFile], { type: 'application/x-bittorrent' });
    } else {
      // If from backend, we might need an endpoint or just rely on magnet for now
      // For this demo, let's assume we can generate a simple one or show alert
      alert('Backend-parsed torrent export is limited. Use the magnet link directly.');
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.name || 'download'}.torrent`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Improved Path Detection
  const path = window.location.pathname.replace(/\/$/, ''); // Remove trailing slash
  const isHoneypotPath = path === '/admin';
  const isRealAdminPath = path === '/10w_gl888'; 

  if (isHoneypotPath || isRealAdminPath) {
    return (
      <div className="container" style={{ paddingTop: '80px' }}>
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">System Management</h1>
          <a href="/" className="btn-google" style={{ textDecoration: 'none' }}>Back to Home</a>
        </header>

        {!isAdmin ? (
          <div className="glass-card" style={{ maxWidth: '400px', margin: '0 auto' }}>
            <h2 style={{ fontSize: '22px', fontWeight: '500', textAlign: 'center', marginBottom: '30px' }}>Admin Sign in</h2>
            <form onSubmit={handleAdminLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {isHoneypotPath && (
                <input 
                  type="text" 
                  placeholder="Email or phone"
                  value={honeypot} 
                  onChange={(e) => setHoneypot(e.target.value)}
                  className="search-box"
                  style={{ borderRadius: '4px', height: 'auto', padding: '12px' }}
                />
              )}
              <input 
                type="password" 
                placeholder="Enter your password" 
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
                className="search-box"
                style={{ borderRadius: '4px', height: 'auto', padding: '12px' }}
              />
              <button type="submit" className="btn-primary">Sign in</button>
            </form>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
            {/* Stats Section */}
            <div className="result-card">
              <h3 className="mb-4 flex items-center gap-2"><Activity size={18} /> Popular Hashes</h3>
              <table className="table-clean">
                <thead>
                  <tr><th>Hash</th><th>Queries</th><th>Last Seen</th></tr>
                </thead>
                <tbody>
                  {adminStats.map((s, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{s.info_hash}</td>
                      <td>{s.query_count}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{s.last_query_time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Trackers Section */}
            <div className="result-card">
              <h3 className="mb-4 flex items-center gap-2"><ShieldCheck size={18} /> Tracker Management
                <button
                  onClick={async () => {
                    if (!window.confirm('将并发检测所有 tracker 可达性，删除无响应的。耗时较长，确定继续？')) return;
                    const token = localStorage.getItem('adminToken');
                    const btn = document.getElementById('cleanBtn');
                    btn.disabled = true;
                    btn.textContent = '检测中...';
                    try {
                      const res = await fetch(`${BACKEND_URL}/api/admin/trackers/clean`, {
                        method: 'POST',
                        headers: { 'X-Admin-Token': token },
                      });
                      const data = await res.json();
                      if (res.ok) {
                        alert(`清理完成，删除了 ${data.removed} 个无效 tracker`);
                        fetchAdminData();
                      } else {
                        alert('清理失败: ' + data.error);
                      }
                    } finally {
                      btn.disabled = false;
                      btn.textContent = '一键清理';
                    }
                  }}
                  id="cleanBtn"
                  className="btn-primary"
                  style={{ marginLeft: 'auto', padding: '0 14px', height: '30px', fontSize: '12px' }}
                >
                  一键清理
                </button>
              </h3>
              
              {/* Add tracker form */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const textarea = e.target.elements.trackerUrl;
                  const url = textarea.value.trim();
                  if (!url) return;
                  const lineCount = url.split('\n').filter(l => l.trim()).length;
                  const token = localStorage.getItem('adminToken');
                  const res = await fetch(`${BACKEND_URL}/api/admin/trackers/add`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
                    body: JSON.stringify({ url }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    textarea.value = '';
                    fetchAdminData();
                    if (lineCount > 1) alert(`成功添加 ${data.count ?? lineCount} 条 Tracker`);
                  } else {
                    alert('添加失败');
                  }
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}
              >
                <textarea
                  name="trackerUrl"
                  rows={3}
                  placeholder={`支持批量粘贴，每行一个：\nudp://tracker.opentrackr.org:1337/announce\nwss://tracker.openwebtorrent.com\nhttps://tracker1.520.jp:443/announce`}
                  className="search-box"
                  style={{ width: '100%', borderRadius: '4px', padding: '8px 12px', fontSize: '13px', resize: 'vertical', fontFamily: 'monospace' }}
                />
                <button type="submit" className="btn-primary" style={{ alignSelf: 'flex-end', padding: '0 20px', height: '36px' }}>
                  添加
                </button>
              </form>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {adminTrackers.map((t, i) => (
                  <div key={i} className="justify-between items-center" style={{ display: 'flex', padding: '10px', borderBottom: '1px solid #f1f3f4' }}>
                    <span className="truncate" style={{ fontSize: '13px', maxWidth: '60%' }}>{t.url}</span>
                    <div className="flex gap-4">
                      <button 
                        onClick={() => toggleTracker(t.id, t.enabled)}
                        style={{ background: 'none', border: 'none', color: t.enabled ? '#1e8e3e' : '#d93025', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                      >
                        {t.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button 
                        onClick={() => deleteTracker(t.id)}
                        style={{ background: 'none', border: 'none', color: '#70757a', cursor: 'pointer', fontSize: '12px' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="result-card">
              <h3 className="mb-4">System Settings</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '500px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '5px' }}>Admin Secret Path</label>
                  <input 
                    type="text" 
                    value={adminSettings.admin_path || ''} 
                    onChange={(e) => setAdminSettings({...adminSettings, admin_path: e.target.value})}
                    className="search-box"
                    style={{ borderRadius: '4px', height: '40px', padding: '0 12px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-dim)', marginBottom: '5px' }}>Tracker Sync Source</label>
                  <input 
                    type="text" 
                    value={adminSettings.tracker_sync_source || ''} 
                    onChange={(e) => setAdminSettings({...adminSettings, tracker_sync_source: e.target.value})}
                    className="search-box"
                    style={{ borderRadius: '4px', height: '40px', padding: '0 12px' }}
                  />
                </div>
                <button onClick={saveSettings} className="btn-primary" style={{ alignSelf: 'flex-start' }}>Save Settings</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container">
      <div className="home-wrapper">
        <img src="/logo.png" alt="Google Magnet" className="logo-main" />
        
        <form onSubmit={handleParse} className="search-box-container">
          <Search className="search-icon" size={20} />
          <input 
            type="text" 
            className="search-box"
            placeholder="Search magnet link..."
            value={magnet}
            onChange={(e) => setMagnet(e.target.value)}
            disabled={parsing}
          />
        </form>

        <div className="flex gap-4">
          <button onClick={handleParse} className="btn-google">Magnet Search</button>
          <button onClick={() => setMagnet('')} className="btn-google">I'm Feeling Lucky</button>
        </div>

        {parsing && (
          <div className="mt-8 flex items-center gap-2 text-text-dim">
            <Loader2 className="animate-spin" size={18} />
            <span>{status}</span>
          </div>
        )}

        {error && (
          <div className="mt-8 text-red-500 text-sm">{error}</div>
        )}

        <AnimatePresence>
          {result && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full mt-10"
            >
              <div className="result-card">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-xl font-medium mb-1">{result.name}</h2>
                    <p className="text-text-dim text-xs font-mono">{result.infoHash}</p>
                  </div>
                  <button onClick={downloadTorrent} className="btn-primary flex items-center gap-2">
                    <Download size={16} /> Export .torrent
                  </button>
                </div>

                <div className="border-t border-border-light pt-4">
                  <p className="text-sm text-text-dim mb-4">Files ({result.files.length}) • Total: {formatSize(result.totalSize)}</p>
                  <div className="space-y-1">
                    {result.files.map((file, i) => (
                      <div key={i} className="file-row">
                        <span className="truncate">{file.path}</span>
                        <span className="text-text-dim">{formatSize(file.size)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <footer className="fixed bottom-0 left-0 w-full p-4 flex justify-center gap-6 text-sm text-text-dim bg-gray-50 border-t border-border-light">
        <span>Privacy</span>
        <span>Terms</span>
        <a href="/10w_gl888" style={{ color: 'inherit', textDecoration: 'none' }}>Settings</a>
      </footer>
    </div>
  );
}

export default App;
