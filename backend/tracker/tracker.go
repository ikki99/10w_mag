package tracker

import (
	"bufio"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"10w_mag/backend/db"
)

func StartSync() {
	// Initial sync + validate
	syncAndClean()

	// Every 24 hours
	ticker := time.NewTicker(24 * time.Hour)
	for range ticker.C {
		syncAndClean()
	}
}

func syncAndClean() {
	fetchRemoteTrackers()
	removed, err := ValidateAndClean()
	if err != nil {
		log.Printf("Tracker validation error: %v\n", err)
	} else {
		log.Printf("Tracker validation done, removed %d dead trackers\n", removed)
	}
}

func fetchRemoteTrackers() {
	log.Println("Starting tracker sync...")
	url := db.GetSetting("tracker_sync_source")
	if url == "" {
		url = "https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_ws.txt"
	}

	resp, err := http.Get(url)
	if err != nil {
		log.Printf("Error fetching trackers: %v\n", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Tracker sync source returned HTTP %d, skipping\n", resp.StatusCode)
		return
	}

	var trackers []string
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" && (strings.HasPrefix(line, "udp://") || strings.HasPrefix(line, "http://") || strings.HasPrefix(line, "https://") || strings.HasPrefix(line, "wss://") || strings.HasPrefix(line, "ws://")) {
			trackers = append(trackers, line)
		}
	}

	if err := db.SaveTrackers(trackers); err != nil {
		log.Printf("Error saving trackers: %v\n", err)
	} else {
		log.Printf("Synced %d trackers\n", len(trackers))
	}
}

// ValidateAndClean 并发检测所有 tracker 可达性，删除无响应的，返回删除数量。
// wss:// 和 ws:// tracker 跳过检测（浏览器专用，服务端无法握手），始终保留。
func ValidateAndClean() (int, error) {
	urls, err := db.GetAllTrackerURLs()
	if err != nil {
		return 0, err
	}
	if len(urls) == 0 {
		return 0, nil
	}

	log.Printf("Validating %d trackers...\n", len(urls))

	type result struct {
		url  string
		dead bool
	}

	results := make(chan result, len(urls))
	sem := make(chan struct{}, 30) // 最多 30 并发

	var wg sync.WaitGroup
	for _, u := range urls {
		wg.Add(1)
		go func(trackerURL string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results <- result{url: trackerURL, dead: !isReachable(trackerURL)}
		}(u)
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	var dead []string
	for r := range results {
		if r.dead {
			dead = append(dead, r.url)
		}
	}

	if len(dead) == 0 {
		return 0, nil
	}
	return db.DeleteDeadTrackers(dead)
}

// isReachable 检测单个 tracker 地址是否可达。
// - udp://  → UDP 拨号（发送空包，能建立连接即视为可达）
// - http/https → HTTP HEAD 请求，5s 超时
// - wss/ws → 跳过，始终返回 true（浏览器专用）
func isReachable(trackerURL string) bool {
	const timeout = 8 * time.Second

	switch {
	case strings.HasPrefix(trackerURL, "wss://") || strings.HasPrefix(trackerURL, "ws://"):
		return true // 不检测，保留

	case strings.HasPrefix(trackerURL, "udp://"):
		host := extractHost(trackerURL, "udp://")
		if host == "" {
			return false
		}
		conn, err := net.DialTimeout("udp", host, timeout)
		if err != nil {
			return false
		}
		conn.Close()
		return true

	case strings.HasPrefix(trackerURL, "http://") || strings.HasPrefix(trackerURL, "https://"):
		client := &http.Client{Timeout: timeout}
		resp, err := client.Head(trackerURL)
		if err != nil {
			return false
		}
		resp.Body.Close()
		// 任何 HTTP 响应（包括 4xx）都说明服务器在线
		return true

	default:
		return false
	}
}

// extractHost 从 tracker URL 中提取 host:port，去掉协议前缀和路径。
func extractHost(u, prefix string) string {
	s := strings.TrimPrefix(u, prefix)
	// 去掉路径部分
	if idx := strings.Index(s, "/"); idx != -1 {
		s = s[:idx]
	}
	return s
}
