package parser

import (
	"context"
	"io"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

// nullStorage 是一个纯内存无磁盘写入的存储后端。
// 由于我们只需要 .info 元数据（GotInfo 触发后立即 Drop），不需要存储任何 piece 数据。
type nullStorage struct{}
type nullPiece struct{}

func newNullStorage() storage.ClientImplCloser {
	return &nullStorage{}
}

func (n *nullStorage) OpenTorrent(_ context.Context, _ *metainfo.Info, _ metainfo.Hash) (storage.TorrentImpl, error) {
	return storage.TorrentImpl{
		Piece: func(p metainfo.Piece) storage.PieceImpl {
			return &nullPiece{}
		},
		Close: func() error { return nil },
	}, nil
}

func (n *nullStorage) Close() error { return nil }

// ReadAt 不返回任何数据（我们从不读取 piece 内容）
func (p *nullPiece) ReadAt(b []byte, _ int64) (int, error) {
	return 0, io.EOF
}

// WriteAt 接受写入但直接丢弃，不写磁盘
func (p *nullPiece) WriteAt(b []byte, _ int64) (int, error) {
	return len(b), nil
}

func (p *nullPiece) MarkComplete() error    { return nil }
func (p *nullPiece) MarkNotComplete() error { return nil }
func (p *nullPiece) Completion() storage.Completion {
	return storage.Completion{Ok: true, Complete: false}
}
