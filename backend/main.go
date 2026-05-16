package main

import (
	"bytes"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
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

const ADMIN_PASS = "10w_gl888" // fallback if DB not initialized
const VERSION = "1.5.2"

//go:embed all:dist
var frontendFS embed.FS

func main() {
	// Production mode: suppress GIN debug output
	gin.SetMode(gin.ReleaseMode)

	// Filter noisy "Unsolicited response" logs from net/http keep-alive internals
	log.SetOutput(&filteredWriter{w: os.Stderr, skip: "Unsolicited response received on idle HTTP channel"})

	// Initialize Database
	if err := db.Init(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Initialize Parser (Singleton)
	if err := parser.Init(); err != nil {
		log.Printf("Warning: Parser init failed: %v", err)
	}

	// Apply saved concurrency setting
	if cv := db.GetSetting("parse_concurrency"); cv != "" {
		var n int
		if _, err := fmt.Sscanf(cv, "%d", &n); err == nil && n > 0 {
			parser.SetConcurrency(n)
		}
	}

	// Initialize Tracker Sync
	go tracker.StartSync()

	// Setup Gin
	r := gin.Default()
	// Only trust loopback proxies (nginx on same host); avoids "trusted all proxies" warning
	r.SetTrustedProxies([]string{"127.0.0.1", "::1"})

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
		api.GET("/torrent/:hash", handleDownloadTorrent)
		api.GET("/search", handleSearch)

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
			admin.GET("/trackers/export", handleExportTrackers)

			// Settings APIs
			admin.GET("/settings", handleGetSettings)
			admin.POST("/settings", handleSaveSettings)
			admin.POST("/change-password", handleChangePassword)
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

		// 3. Fallback to index.html for SPA routing — inject admin path
		file, err := fs.ReadFile(fe, "index.html")
		if err != nil {
			c.String(http.StatusNotFound, "Frontend not found")
			return
		}
		adminPath := db.GetSetting("admin_path")
		if adminPath == "" {
			adminPath = "10w_gl888"
		}
		inject := fmt.Sprintf(`<script>window.__ADMIN_PATH__="%s";</script></head>`, adminPath)
		html := strings.Replace(string(file), "</head>", inject, 1)
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))
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

	// If the cached version is old and lacks the torrent data, treat as miss
	if result.TorrentBase64 == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "incomplete cache"})
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

	// 1. Check Cache (with "must have torrent data" requirement)
	if infoHash != "" {
		cached, err := db.GetMetadata(infoHash)
		if err == nil && cached != "" {
			var result parser.ParseResult
			if json.Unmarshal([]byte(cached), &result) == nil {
				// Only return cache if it's complete with seed data
				if result.TorrentBase64 != "" {
					db.IncrementStats(infoHash, "")
					c.JSON(http.StatusOK, result)
					return
				}
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

// handleDownloadTorrent serves the .torrent file for a given info hash directly.
// Using a real HTTP download works in all in-app browsers (TG, WeChat, etc.)
// that block blob:// URL downloads.
func handleDownloadTorrent(c *gin.Context) {
	hash := strings.ToLower(c.Param("hash"))
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
	if json.Unmarshal([]byte(cached), &result) != nil || result.TorrentBase64 == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "torrent data unavailable"})
		return
	}
	data, err := base64.StdEncoding.DecodeString(result.TorrentBase64)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to decode torrent"})
		return
	}
	name := result.Name
	if name == "" {
		name = hash
	}
	safe := strings.NewReplacer("/","_","\\","_",":","_","*","_","?","_",`"`,"_","<","_",">","_","|","_").Replace(name)
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.torrent"`, safe))
	c.Data(http.StatusOK, "application/x-bittorrent", data)
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

func handleSearch(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if len(q) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "query too short"})
		return
	}
	results, err := db.SearchCache(q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("X-Admin-Token")
		storedPass := db.GetSetting("admin_password")
		if storedPass == "" {
			storedPass = ADMIN_PASS
		}
		if token != storedPass {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func handleAdminLogin(c *gin.Context) {
	var input struct {
		Trap     string `json:"trap"`     // honeypot field
		Username string `json:"username"` // real username
		Password string `json:"password"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Honeypot check
	if input.Trap != "" {
		log.Printf("Honeypot triggered by IP: %s", c.ClientIP())
		time.Sleep(2 * time.Second)
		c.JSON(http.StatusForbidden, gin.H{"error": "Bot detected"})
		return
	}

	storedUser := db.GetSetting("admin_username")
	if storedUser == "" {
		storedUser = "admin"
	}
	storedPass := db.GetSetting("admin_password")
	if storedPass == "" {
		storedPass = ADMIN_PASS
	}

	if input.Username == storedUser && input.Password == storedPass {
		c.JSON(http.StatusOK, gin.H{"token": storedPass})
	} else {
		time.Sleep(1 * time.Second)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
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
		"admin_username":      db.GetSetting("admin_username"),
		"backend_enabled":     db.GetSetting("backend_enabled"),
		"tracker_sync_source": db.GetSetting("tracker_sync_source"),
		"parse_concurrency":   db.GetSetting("parse_concurrency"),
		"tracker_max_count":   db.GetSetting("tracker_max_count"),
		"tracker_count":       fmt.Sprintf("%d", db.GetTrackerCount()),
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
		// Live-apply concurrency change without restart
		if k == "parse_concurrency" {
			var n int
			if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n > 0 {
				parser.SetConcurrency(n)
			}
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "Settings saved"})
}

func handleExportTrackers(c *gin.Context) {
	urls, err := db.GetTrackers() // enabled only
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Disposition", "attachment; filename=\"trackers.txt\"")
	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.String(http.StatusOK, strings.Join(urls, "\n"))
}

func handleChangePassword(c *gin.Context) {
	var input struct {
		OldPassword string `json:"old_password"`
		NewUsername string `json:"new_username"`
		NewPassword string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid input"})
		return
	}
	storedPass := db.GetSetting("admin_password")
	if storedPass == "" {
		storedPass = ADMIN_PASS
	}
	if input.OldPassword != storedPass {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "旧密码不正确"})
		return
	}
	if len(input.NewPassword) < 6 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "新密码至少6位"})
		return
	}
	if input.NewUsername != "" {
		db.SetSetting("admin_username", input.NewUsername)
	}
	db.SetSetting("admin_password", input.NewPassword)
	c.JSON(http.StatusOK, gin.H{"message": "凭据已更新，请重新登录", "new_token": input.NewPassword})
}

// filteredWriter wraps an io.Writer and drops lines containing a given substring.
type filteredWriter struct {
	w    io.Writer
	skip string
}

func (f *filteredWriter) Write(p []byte) (n int, err error) {
	if bytes.Contains(p, []byte(f.skip)) {
		return len(p), nil // silently discard
	}
	return f.w.Write(p)
}
