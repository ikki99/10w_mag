package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"10w_mag/backend/db"
	"10w_mag/backend/parser"
	"10w_mag/backend/tracker"

	"github.com/gin-gonic/gin"
)

const ADMIN_PASS = "10w_gl888"
const VERSION = "0.2.0"

//go:embed all:dist
var frontendFS embed.FS

func main() {
	// Initialize Database
	if err := db.Init(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Initialize Parser (Singleton)
	if err := parser.Init(); err != nil {
		log.Printf("Warning: Parser init failed: %v", err)
	}

	// Initialize Tracker Sync
	go tracker.StartSync()

	// Setup Gin
	r := gin.Default()

	// CORS Middleware
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// API Routes
	api := r.Group("/api")
	{
		api.GET("/parse", handleParse)
		api.GET("/parse/cache", handleCacheCheck)
		api.GET("/stats/:hash", handleStats)
		api.GET("/trackers", handleTrackers)

		// Admin Login
		api.POST("/admin/login", handleAdminLogin)

		// Protected Admin Routes
		admin := api.Group("/admin")
		admin.Use(authMiddleware())
		{
			admin.GET("/stats", handleAllStats)
			admin.GET("/trackers", handleTrackersAdmin)
			admin.POST("/trackers/add", handleAddTracker)
			admin.POST("/trackers/toggle", handleToggleTracker)
			admin.DELETE("/trackers/:id", handleDeleteTracker)
			admin.POST("/trackers/clean", handleCleanTrackers)

			// Settings APIs
			admin.GET("/settings", handleGetSettings)
			admin.POST("/settings", handleSaveSettings)
		}
	}

	// Serve Frontend (Embedded)
	fe, _ := fs.Sub(frontendFS, "dist")

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path

		// 1. Try to serve file from FS (e.g. /logo.png, /assets/...)
		f, err := fe.Open(path[1:]) // strip leading slash
		if err == nil {
			f.Close()
			http.FileServer(http.FS(fe)).ServeHTTP(c.Writer, c.Request)
			return
		}

		// 2. Honeypot Check
		if path == "/admin" {
			log.Printf("Honeypot (Path) triggered by IP: %s", c.ClientIP())
		}

		// 3. Fallback to index.html for SPA routing
		file, err := fs.ReadFile(fe, "index.html")
		if err != nil {
			c.String(http.StatusNotFound, "Frontend not found")
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", file)
	})

	// Default Port: 6467
	port := os.Getenv("PORT")
	if port == "" {
		port = "6467"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}

// handleCacheCheck checks if a result for a given info hash is already in the DB.
// Returns 200 + cached result if found, 404 if not.
func handleCacheCheck(c *gin.Context) {
	hash := strings.ToLower(c.Query("hash"))
	if hash == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "hash is required"})
		return
	}
	cached, err := db.GetMetadata(hash)
	if err != nil || cached == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "not cached"})
		return
	}
	var result parser.ParseResult
	if json.Unmarshal([]byte(cached), &result) != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "invalid cache"})
		return
	}
	db.IncrementStats(hash, "")
	c.JSON(http.StatusOK, result)
}

func handleParse(c *gin.Context) {
	magnet := c.Query("magnet")
	if magnet == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Magnet link is required"})
		return
	}

	// Extract InfoHash
	infoHash := ""
	parts := strings.Split(magnet, "btih:")
	if len(parts) > 1 {
		infoHash = strings.Split(parts[1], "&")[0]
		infoHash = strings.ToLower(infoHash)
	}

	// 1. Check Cache
	if infoHash != "" {
		cached, err := db.GetMetadata(infoHash)
		if err == nil && cached != "" {
			var result parser.ParseResult
			if json.Unmarshal([]byte(cached), &result) == nil {
				db.IncrementStats(infoHash, "") // Just increment count
				c.JSON(http.StatusOK, result)
				return
			}
		}
	}

	// 2. Get trackers to inject
	trackers, _ := db.GetTrackers()

	// 3. Parse using singleton client
	result, err := parser.Parse(magnet, trackers)
	if err != nil {
		if err.Error() == "timeout" {
			c.JSON(http.StatusRequestTimeout, gin.H{"error": "timeout"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	// 4. Save to cache and increment stats
	resultJSON, _ := json.Marshal(result)
	db.IncrementStats(result.InfoHash, string(resultJSON))

	c.JSON(http.StatusOK, result)
}

func handleStats(c *gin.Context) {
	hash := c.Param("hash")
	stats, err := db.GetStats(hash)
	if err != nil {
		// Return default stats instead of 404
		c.JSON(http.StatusOK, gin.H{
			"info_hash":       hash,
			"query_count":     0,
			"last_query_time": "-",
		})
		return
	}
	c.JSON(http.StatusOK, stats)
}

func handleTrackers(c *gin.Context) {
	trackers, err := db.GetTrackers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, trackers)
}

func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("X-Admin-Token")
		if token != ADMIN_PASS {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func handleAdminLogin(c *gin.Context) {
	var input struct {
		Honeypot string `json:"username"` // This is the honeypot
		Password string `json:"password"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Honeypot check: If the fake "username" field is filled, reject!
	if input.Honeypot != "" {
		log.Printf("Honeypot triggered by IP: %s", c.ClientIP())
		// Artificial delay to waste attacker's time
		time.Sleep(2 * time.Second)
		c.JSON(http.StatusForbidden, gin.H{"error": "Bot detected"})
		return
	}

	if input.Password == ADMIN_PASS {
		c.JSON(http.StatusOK, gin.H{"token": ADMIN_PASS})
	} else {
		time.Sleep(1 * time.Second)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid password"})
	}
}

func handleAllStats(c *gin.Context) {
	stats, err := db.GetAllStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

func handleTrackersAdmin(c *gin.Context) {
	trackers, err := db.GetTrackersAdmin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, trackers)
}

func handleAddTracker(c *gin.Context) {
	var input struct {
		URL string `json:"url"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid input"})
		return
	}
	// 支持多行粘贴：按换行、回车、空白行分割，过滤空项
	rawLines := strings.FieldsFunc(input.URL, func(r rune) bool {
		return r == '\n' || r == '\r'
	})
	var urls []string
	for _, line := range rawLines {
		line = strings.TrimSpace(line)
		if line != "" {
			urls = append(urls, line)
		}
	}
	if len(urls) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid URLs provided"})
		return
	}
	if err := db.SaveTrackers(urls); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("%d tracker(s) added", len(urls)), "count": len(urls)})
}

func handleToggleTracker(c *gin.Context) {
	var input struct {
		ID      int `json:"id"`
		Enabled int `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid input"})
		return
	}
	if err := db.ToggleTracker(input.ID, input.Enabled); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Tracker updated"})
}

func handleDeleteTracker(c *gin.Context) {
	id := c.Param("id")
	if err := db.DeleteTracker(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Tracker deleted"})
}

func handleCleanTrackers(c *gin.Context) {
	removed, err := tracker.ValidateAndClean()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Removed %d dead trackers", removed), "removed": removed})
}

func handleGetSettings(c *gin.Context) {
	settings := map[string]string{
		"admin_path":          db.GetSetting("admin_path"),
		"backend_enabled":     db.GetSetting("backend_enabled"),
		"tracker_sync_source": db.GetSetting("tracker_sync_source"),
	}
	c.JSON(http.StatusOK, settings)
}

func handleSaveSettings(c *gin.Context) {
	var input map[string]string
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid input"})
		return
	}
	for k, v := range input {
		db.SetSetting(k, v)
	}
	c.JSON(http.StatusOK, gin.H{"message": "Settings saved"})
}
