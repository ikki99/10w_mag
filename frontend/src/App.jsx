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
  const clientRef = useRef(null);

  useEffect(() => {
    clientRef.current = new WebTorrent();
    return () => {
      clientRef.current.destroy();
    };
  }, []);

  const handleParse = async (e) => {
    e.preventDefault();
    if (!magnet.trim()) return;

    setParsing(true);
    setResult(null);
    setError(null);
    setStatus('Initializing Client...');

    try {
      // 1. Try Frontend Parsing (WebTorrent)
      setStatus('Searching DHT & Peers (Client-side)...');
      
      const timeout = setTimeout(() => {
        if (!result) {
          setStatus('Client-side timeout. Falling back to Backend...');
          parseWithBackend(magnet);
        }
      }, 10000); // 10s timeout for browser parsing

      clientRef.current.add(magnet, (torrent) => {
        clearTimeout(timeout);
        setStatus('Metadata Found!');
        const files = torrent.files.map(f => ({ path: f.path, size: f.length }));
        const res = {
          infoHash: torrent.infoHash,
          name: torrent.name,
          files,
          totalSize: torrent.length,
          torrentFile: torrent.torrentFile // This is a Buffer
        };
        setResult(res);
        setParsing(false);
        fetchStats(torrent.infoHash);
      });

    } catch (err) {
      console.error('Frontend error:', err);
      parseWithBackend(magnet);
    }
  };

  const parseWithBackend = async (magnetURI) => {
    try {
      setStatus('Parsing via Backend...');
      const response = await fetch(`${BACKEND_URL}/api/parse?magnet=${encodeURIComponent(magnetURI)}`);
      if (!response.ok) throw new Error('Backend parsing failed');
      const data = await response.json();
      setResult(data);
      setParsing(false);
      fetchStats(data.infoHash);
    } catch (err) {
      setError('Failed to parse magnet link. Please ensure it is valid and has active peers.');
      setParsing(false);
    }
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

  return (
    <div className="min-h-screen relative p-4 md:p-8">
      <div className="bg-mesh"></div>
      
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <header className="text-center space-y-4 pt-12">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold mb-4"
          >
            <ShieldCheck size={16} /> 0 Privacy • Green • Fast
          </motion.div>
          <motion.h1 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-5xl md:text-6xl font-extrabold gradient-text"
          >
            10W Magnet Parser
          </motion.h1>
          <motion.p 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-text-dim text-lg max-w-xl mx-auto"
          >
            The world's most private magnet link analyzer. 
            No logs, no trackers, just pure metadata.
          </motion.p>
        </header>

        {/* Search Bar */}
        <motion.div 
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="glass-card"
        >
          <form onSubmit={handleParse} className="flex flex-col md:flex-row gap-4">
            <div className="input-container flex-grow">
              <input 
                type="text" 
                placeholder="Paste magnet link here..." 
                value={magnet}
                onChange={(e) => setMagnet(e.target.value)}
                disabled={parsing}
              />
            </div>
            <button type="submit" className="btn-primary flex items-center justify-center gap-2 min-w-[160px]" disabled={parsing}>
              {parsing ? <Loader2 className="animate-spin" /> : <Search size={20} />}
              {parsing ? 'Parsing...' : 'Analyze'}
            </button>
          </form>
          
          <AnimatePresence>
            {parsing && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-6 flex items-center gap-4 text-primary text-sm"
              >
                <Activity size={18} className="animate-pulse" />
                <span>{status}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center gap-3 text-red-400"
            >
              <AlertCircle size={20} />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        <AnimatePresence>
          {result && (
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="glass-card">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">{result.name}</h2>
                    <p className="text-text-dim text-sm font-mono break-all">{result.infoHash}</p>
                  </div>
                  <div className="flex gap-2">
                    {stats && (
                      <div className="status-badge status-success">
                        <Activity size={14} /> {stats.query_count} Queries
                      </div>
                    )}
                    <button onClick={downloadTorrent} className="btn-primary py-2 px-4 flex items-center gap-2 text-xs">
                      <Download size={16} /> Export .torrent
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-text-dim text-sm mb-4">
                    <FileText size={16} />
                    <span>Files ({result.files.length}) • Total: {formatSize(result.totalSize)}</span>
                  </div>
                  <div className="max-h-[400px] overflow-y-auto rounded-xl border border-glass-border">
                    {result.files.map((file, i) => (
                      <div key={i} className="file-item">
                        <div className="flex items-center gap-3 truncate pr-4">
                          <ChevronRight size={14} className="text-primary" />
                          <span className="truncate">{file.path}</span>
                        </div>
                        <span className="text-text-dim whitespace-nowrap">{formatSize(file.size)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className="text-center text-text-dim text-sm pb-12">
          <p>© 2026 10W Magnet Parser. Built for a cleaner, safer web.</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
