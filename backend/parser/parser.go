package parser

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/anacrolix/torrent"
)

type ParseResult struct {
	InfoHash string `json:"infoHash"`
	Name     string `json:"name"`
	Files    []File `json:"files"`
	Size     int64  `json:"totalSize"`
}

type File struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

func Parse(magnetURI string) (*ParseResult, error) {
	cfg := torrent.NewDefaultClientConfig()
	cfg.NoUpload = true
	cfg.DisableTrackers = false
	cfg.NoDHT = false
	cfg.Seed = false
	cfg.DataDir = "/tmp" // We won't actually download data

	client, err := torrent.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("error creating torrent client: %v", err)
	}
	defer client.Close()

	t, err := client.AddMagnet(magnetURI)
	if err != nil {
		return nil, fmt.Errorf("error adding magnet: %v", err)
	}

	// Timeout for metadata parsing
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	select {
	case <-t.GotInfo():
		// Success
	case <-ctx.Done():
		return nil, fmt.Errorf("metadata parsing timed out")
	}

	info := t.Info()
	var files []File
	var totalSize int64

	if info.Files != nil {
		for _, f := range info.Files {
			path := ""
			if len(f.Path) > 0 {
				path = strings.Join(f.Path, "/")
			}
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

	return &ParseResult{
		InfoHash: t.InfoHash().String(),
		Name:     info.Name,
		Files:    files,
		Size:     totalSize,
	}, nil
}
