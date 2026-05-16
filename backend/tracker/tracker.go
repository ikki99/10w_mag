package tracker

import (
	"bufio"
	"log"
	"net/http"
	"strings"
	"time"

	"10w_mag/backend/db"
)

func StartSync() {
	// Initial sync
	sync()

	// Sync every 24 hours
	ticker := time.NewTicker(24 * time.Hour)
	for range ticker.C {
		sync()
	}
}

func sync() {
	log.Println("Starting tracker sync...")
	url := "https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt"
	
	resp, err := http.Get(url)
	if err != nil {
		log.Printf("Error fetching trackers: %v\n", err)
		return
	}
	defer resp.Body.Close()

	var trackers []string
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			trackers = append(trackers, line)
		}
	}

	if err := db.SaveTrackers(trackers); err != nil {
		log.Printf("Error saving trackers: %v\n", err)
	} else {
		log.Printf("Synced %d trackers\n", len(trackers))
	}
}
