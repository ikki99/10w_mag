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
			last_query_time DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
	}

	for _, q := range queries {
		if _, err := database.Exec(q); err != nil {
			return fmt.Errorf("error creating table: %v", err)
		}
	}

	return nil
}

func IncrementStats(hash string) {
	_, err := database.Exec(`
		INSERT INTO hash_stats (info_hash, query_count, last_query_time)
		VALUES (?, 1, CURRENT_TIMESTAMP)
		ON CONFLICT(info_hash) DO UPDATE SET
			query_count = query_count + 1,
			last_query_time = CURRENT_TIMESTAMP
	`, hash)
	if err != nil {
		fmt.Printf("Error incrementing stats: %v\n", err)
	}
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
