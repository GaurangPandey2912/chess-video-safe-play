# Chess Video — Safe Play

A Chrome extension for [chess.com](https://www.chess.com) that adds 1-on-1 video chat with automatic sensitive content monitoring.

## Features

- **Peer-to-peer video chat** — WebRTC-based using PeerJS; no intermediate server beyond the signaling layer
- **Skin-tone detection** — Video frames are analysed client-side; if a threshold is surpassed the feed is temporarily blurred
- **Chat monitoring** — Messages are scanned against a blocklist; flagged messages trigger a temporary overlay
- **Minimal UI** — A floating control bar at the bottom-right of chess.com pages

## How it works

1. Install the extension (load the unpacked folder via `chrome://extensions`)
2. Open a chess.com game
3. Click **Start Video** — a room ID is generated and copied to your clipboard
4. Share the room ID with your opponent
5. They paste it into the input and click **Join**
6. Once connected, both video feeds appear. The extension periodically scans the remote video and chat for sensitive content.

## Project structure

```
├── manifest.json       # Extension manifest (v3)
├── background.js       # Service worker — handles message relay
├── content.js          # Main logic — UI, WebRTC, monitoring
├── styles.css          # Floating control bar and video overlay styles
├── popup.html          # Browser-action popup
├── icons/              # Extension icons (16, 48, 128)
├── lib/
│   └── peerjs.min.js   # PeerJS client library
```

## Privacy

All video and chat analysis happens **entirely on the client side**. No data is sent to any server. The only network connections are the direct WebRTC peer-to-peer stream and the PeerJS signaling broker.

## License

MIT
