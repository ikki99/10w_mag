package main

import (
	"log"
	"net/http"
	"os"

	"10w_mag/backend/db"
	"10w_mag/backend/parser"
	"10w_mag/backend/tracker"

	"github.com/gin-gonic/gin"
)

func main() {
	// Initialize Database
	if err := db.Init(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Initialize Tracker Sync
	go tracker.StartSync()

	// Setup Gin
	r := gin.Default()

	// CORS Middleware
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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
		api.GET("/stats/:hash", handleStats)
		api.GET("/trackers", handleTrackers)
	}

	// Default Port: 6467
	port := os.Getenv("PORT")
	if port == "" {
		port = "6467"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
}

func handleParse(c *gin.Context) {
	magnet := c.Query("magnet")
	if magnet == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Magnet link is required"})
		return
	}

	result, err := parser.Parse(magnet)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Increment stats
	db.IncrementStats(result.InfoHash)

	c.JSON(http.StatusOK, result)
}

func handleStats(c *gin.Context) {
	hash := c.Param("hash")
	stats, err := db.GetStats(hash)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Stats not found"})
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
