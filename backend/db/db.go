package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

var database *sql.DB

func Init() error {
	dbPath := "./mag.db"
	dbDir := filepath.Dir(dbPath)
	if _, err := os.Stat(dbDir); os.IsNotExist(err) {
		os.MkdirAll(dbDir, 0755)
	}

	var err error
	database, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return err
	}

	// Create tables
	queries := []string{
		`CREATE TABLE IF NOT EXISTS trackers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			url TEXT UNIQUE,
			enabled INTEGER DEFAULT 1,
			last_success DATETIME,
			last_fail DATETIME
		)`,
		`CREATE TABLE IF NOT EXISTS hash_stats (
			info_hash TEXT PRIMARY KEY,
			query_count INTEGER DEFAULT 0,
			last_query_time DATETIME DEFAULT CURRENT_TIMESTAMP,
			metadata TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT
		)`,
	}

	for _, q := range queries {
		if _, err := database.Exec(q); err != nil {
			return fmt.Errorf("error creating table: %v", err)
		}
	}

	// Default Settings
	defaults := map[string]string{
		"admin_path":          "10w_gl888",
		"backend_enabled":     "1",
		"tracker_sync_source": "https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_ws.txt",
	}

	for k, v := range defaults {
		database.Exec("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", k, v)
	}

	// Seed reliable trackers (wss:// for browser frontend, udp:// for backend parser)
	seedTrackers := []string{
		// WSS — browser frontend
		"wss://tracker.openwebtorrent.com",
		"wss://tracker.webtorrent.dev",
		// UDP — backend parser (high-reliability public trackers)
		"udp://tracker.opentrackr.org:1337/announce",
		"udp://open.stealth.si:80/announce",
		"udp://tracker.torrent.eu.org:451/announce",
		"udp://tracker.bittor.pw:1337/announce",
		"udp://tracker.moeking.me:6969/announce",
		"udp://tracker-udp.gbitt.info:80/announce",
		"udp://explodie.org:6969/announce",
		"udp://exodus.desync.com:6969/announce",
		"udp://tracker.tiny-vps.com:6969/announce",
		"udp://retracker01-msk-virt.corbina.net:80/announce",
		"udp://tracker1.bt.moack.co.kr:80/announce",
		"udp://tracker.au.au.com:6969/announce",
		"udp://tt.ghostchu.cn:443/announce",
		"udp://ttacker.lanta.me:6969/announce",
		// HTTP — backend parser
		"https://tracker1.520.jp:443/announce",
		"https://tracker2.ctix.cn:443/announce",
		"https://tracker.tamersunion.org:443/announce",
		"http://tracker.openbittorrent.com:80/announce",
		"http://tracker3.itzmx.com:6961/announce",
		"http://open.acgnxtracker.com:80/announce",
	}
	for _, tr := range seedTrackers {
		database.Exec("INSERT OR IGNORE INTO trackers (url) VALUES (?)", tr)
	}

	return nil
}

func GetSetting(key string) string {
	var val string
	database.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&val)
	return val
}

func SetSetting(key, value string) error {
	_, err := database.Exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?", key, value, value)
	return err
}

func IncrementStats(hash string, metadata string) {
	_, err := database.Exec(`
		INSERT INTO hash_stats (info_hash, query_count, last_query_time, metadata)
		VALUES (?, 1, CURRENT_TIMESTAMP, ?)
		ON CONFLICT(info_hash) DO UPDATE SET 
			query_count = query_count + 1, 
			last_query_time = CURRENT_TIMESTAMP,
			metadata = CASE WHEN ? != '' THEN ? ELSE metadata END
	`, hash, metadata, metadata, metadata)
	if err != nil {
		fmt.Printf("Error incrementing stats: %v\n", err)
	}
}

func GetMetadata(hash string) (string, error) {
	var metadata string
	err := database.QueryRow("SELECT metadata FROM hash_stats WHERE info_hash = ?", hash).Scan(&metadata)
	if err != nil {
		return "", err
	}
	return metadata, nil
}

func GetStats(hash string) (map[string]interface{}, error) {
	var count int
	var lastTime string
	err := database.QueryRow("SELECT query_count, last_query_time FROM hash_stats WHERE info_hash = ?", hash).Scan(&count, &lastTime)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"info_hash":       hash,
		"query_count":     count,
		"last_query_time": lastTime,
	}, nil
}

func GetTrackers() ([]string, error) {
	rows, err := database.Query("SELECT url FROM trackers WHERE enabled = 1")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trackers []string
	for rows.Next() {
		var url string
		if err := rows.Scan(&url); err != nil {
			continue
		}
		trackers = append(trackers, url)
	}
	return trackers, nil
}

func GetTrackersAdmin() ([]map[string]interface{}, error) {
	rows, err := database.Query("SELECT id, url, enabled FROM trackers")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var trackers []map[string]interface{}
	for rows.Next() {
		var id int
		var url string
		var enabled int
		rows.Scan(&id, &url, &enabled)
		trackers = append(trackers, map[string]interface{}{
			"id":      id,
			"url":     url,
			"enabled": enabled,
		})
	}
	return trackers, nil
}

func GetAllStats() ([]map[string]interface{}, error) {
	rows, err := database.Query("SELECT info_hash, query_count, last_query_time FROM hash_stats ORDER BY query_count DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []map[string]interface{}
	for rows.Next() {
		var hash, lastTime string
		var count int
		rows.Scan(&hash, &count, &lastTime)
		stats = append(stats, map[string]interface{}{
			"info_hash":       hash,
			"query_count":     count,
			"last_query_time": lastTime,
		})
	}
	return stats, nil
}

func ToggleTracker(id int, enabled int) error {
	_, err := database.Exec("UPDATE trackers SET enabled = ? WHERE id = ?", enabled, id)
	return err
}

func DeleteTracker(id string) error {
	_, err := database.Exec("DELETE FROM trackers WHERE id = ?", id)
	return err
}

// DeleteDeadTrackers 批量删除指定 URL 的 tracker，返回实际删除数量
func DeleteDeadTrackers(urls []string) (int, error) {
	if len(urls) == 0 {
		return 0, nil
	}
	tx, err := database.Begin()
	if err != nil {
		return 0, err
	}
	stmt, err := tx.Prepare("DELETE FROM trackers WHERE url = ?")
	if err != nil {
		tx.Rollback()
		return 0, err
	}
	defer stmt.Close()
	total := 0
	for _, u := range urls {
		res, err := stmt.Exec(u)
		if err == nil {
			n, _ := res.RowsAffected()
			total += int(n)
		}
	}
	return total, tx.Commit()
}

// GetAllTrackerURLs 返回所有 tracker 的 URL（不论 enabled 状态）
func GetAllTrackerURLs() ([]string, error) {
	rows, err := database.Query("SELECT url FROM trackers")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var urls []string
	for rows.Next() {
		var u string
		if rows.Scan(&u) == nil {
			urls = append(urls, u)
		}
	}
	return urls, nil
}

func SaveTrackers(urls []string) error {
	tx, err := database.Begin()
	if err != nil {
		return err
	}

	stmt, _ := tx.Prepare("INSERT OR IGNORE INTO trackers (url) VALUES (?)")
	for _, url := range urls {
		stmt.Exec(url)
	}
	stmt.Close()

	return tx.Commit()
}
