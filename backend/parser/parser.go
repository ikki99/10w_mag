package parser

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
)

type ParseResult struct {
	InfoHash      string `json:"infoHash"`
	Name          string `json:"name"`
	Files         []File `json:"files"`
	Size          int64  `json:"totalSize"`
	TorrentBase64 string `json:"torrentBase64,omitempty"`
}

type File struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

var globalClient *torrent.Client

// ── Concurrency semaphore ────────────────────────────────────────────────────
// Dynamic: channel is replaced atomically; in-flight goroutines hold old ref
var (
	parseSemCh    = make(chan struct{}, 15)
	parseSemMu    sync.RWMutex
	parseSemLimit = 15
)

// SetConcurrency adjusts the max simultaneous DHT parse goroutines.
func SetConcurrency(n int) {
	if n < 1 {
		n = 1
	}
	if n > 200 {
		n = 200
	}
	parseSemMu.Lock()
	parseSemLimit = n
	parseSemCh = make(chan struct{}, n)
	parseSemMu.Unlock()
}

// GetConcurrency returns the current limit.
func GetConcurrency() int {
	parseSemMu.RLock()
	defer parseSemMu.RUnlock()
	return parseSemLimit
}

// In-memory result cache to avoid re-fetching same info hash
var (
	resultCache   = make(map[string]*ParseResult)
	resultCacheMu sync.RWMutex
)

func Init() error {
	cfg := torrent.NewDefaultClientConfig()
	cfg.NoUpload = true
	cfg.DisableTrackers = false
	cfg.NoDHT = false
	cfg.Seed = false
	// 使用纯内存 no-op 存储，不写任何文件到磁盘
	cfg.DefaultStorage = newNullStorage()

	// Tune for faster metadata discovery
	cfg.DisableTCP = false
	cfg.DisableUTP = false
	cfg.EstablishedConnsPerTorrent = 25
	cfg.HalfOpenConnsPerTorrent = 10

	var err error
	globalClient, err = torrent.NewClient(cfg)
	if err != nil {
		return fmt.Errorf("error creating torrent client: %v", err)
	}

	return nil
}

// isValidTrackerURL 检查 tracker URL 是否合法。
// anacrolix/torrent 内部断言 url.Parse(raw).String() == raw，
// 含空格或其他特殊字符的 URL 会导致 panic。
func isValidTrackerURL(tr string) bool {
	if strings.ContainsAny(tr, " \t\r\n") {
		return false
	}
	u, err := url.Parse(tr)
	if err != nil {
		return false
	}
	return u.String() == tr
}

// sanitizeMagnet 移除 magnet URI 中不合法的 &tr= 参数，防止库内部 panic。
func sanitizeMagnet(magnetURI string) string {
	const prefix = "magnet:?"
	if !strings.HasPrefix(magnetURI, prefix) {
		return magnetURI
	}
	parts := strings.Split(magnetURI[len(prefix):], "&")
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		if !strings.HasPrefix(part, "tr=") {
			clean = append(clean, part)
			continue
		}
		decoded, err := url.QueryUnescape(part[3:])
		if err != nil || !isValidTrackerURL(decoded) {
			continue // 丢弃非法 tracker
		}
		clean = append(clean, part)
	}
	return prefix + strings.Join(clean, "&")
}

func Parse(magnetURI string, extraTrackers []string) (*ParseResult, error) {
	if globalClient == nil {
		return nil, fmt.Errorf("torrent client not initialized")
	}

	// 去除首尾空白，并净化 magnet 自带的非法 tracker 参数
	magnetURI = sanitizeMagnet(strings.TrimSpace(magnetURI))

	// 注入额外 tracker，注入前验证合法性
	for _, tr := range extraTrackers {
		tr = strings.TrimSpace(tr)
		if tr == "" {
			continue
		}
		// anacrolix/torrent 不支持 WebSocket tracker
		if strings.HasPrefix(tr, "wss://") || strings.HasPrefix(tr, "ws://") {
			continue
		}
		// 跳过含空格或无法通过库断言的 URL，否则会 panic
		if !isValidTrackerURL(tr) {
			continue
		}
		encoded := url.QueryEscape(tr)
		if !strings.Contains(magnetURI, encoded) && !strings.Contains(magnetURI, tr) {
			magnetURI += "&tr=" + encoded
		}
	}

	t, err := globalClient.AddMagnet(magnetURI)
	if err != nil {
		return nil, fmt.Errorf("error adding magnet: %v", err)
	}

	infoHash := t.InfoHash().String()

	// Check in-memory cache first (before acquiring semaphore)
	resultCacheMu.RLock()
	if cached, ok := resultCache[infoHash]; ok {
		resultCacheMu.RUnlock()
		return cached, nil
	}
	resultCacheMu.RUnlock()

	// Acquire concurrency semaphore — blocks if too many DHT parses in-flight
	parseSemMu.RLock()
	sem := parseSemCh
	parseSemMu.RUnlock()
	sem <- struct{}{}
	defer func() { <-sem }()

	// If metadata is already available (torrent was previously added)
	if t.Info() != nil {
		result := formatResult(t)
		cacheResult(infoHash, result)
		return result, nil
	}

	// Wait for metadata
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	select {
	case <-t.GotInfo():
		result := formatResult(t)
		cacheResult(infoHash, result)
		// Drop the torrent to free connection resources; result is cached
		t.Drop()
		return result, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("timeout")
	}
}

func cacheResult(infoHash string, result *ParseResult) {
	resultCacheMu.Lock()
	resultCache[infoHash] = result
	resultCacheMu.Unlock()
}

func formatResult(t *torrent.Torrent) *ParseResult {
	info := t.Info()
	var files []File
	var totalSize int64

	if info.Files != nil {
		for _, f := range info.Files {
			path := strings.Join(f.Path, "/")
			files = append(files, File{
				Path: path,
				Size: f.Length,
			})
			totalSize += f.Length
		}
	} else {
		files = append(files, File{
			Path: info.Name,
			Size: info.Length,
		})
		totalSize = info.Length
	}

	res := &ParseResult{
		InfoHash: t.InfoHash().String(),
		Name:     info.Name,
		Files:    files,
		Size:     totalSize,
	}

	// Ensure we get a valid .torrent file by marshaling the Metainfo correctly
	mi := t.Metainfo()
	// The key is to ensure the Info section is present. anacrolix/torrent usually
	// populates this if t.GotInfo() has fired.
	if b, err := bencode.Marshal(mi); err == nil {
		res.TorrentBase64 = base64.StdEncoding.EncodeToString(b)
	}

	return res
}
