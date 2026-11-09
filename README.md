# Seedr.cc Unofficial API Wrapper

Fixed & improved version of the original `seedr` package.

**Endpoints still work** (as of Nov 2026). Seedr has not removed the old Chrome / XBMC OAuth endpoints.

## Install

```bash
npm install axios form-data
# or just use the files in this folder
```

## Quick Start

```js
const Seedr = require("seedr"); // or "seedr" if published
const seedr = new Seedr();

// Method 1: email + password (short lived token)
await seedr.login("you@email.com", "password");

// Method 2: Device code (long lived ~1 year token) — recommended
const codes = await seedr.getDeviceCode();
// → Go to https://www.seedr.cc/devices and enter the user_code
// After authorizing:
await seedr.getToken(codes.device_code);

// Method 3: reuse old token
await seedr.addToken("your_access_token", "optional_refresh_token");
```

## Main Methods

| Method | Description |
|--------|-------------|
| `login(email, pass)` | Login with password |
| `getDeviceCode()` | Start device auth flow |
| `getToken(device_code)` | Finish device auth |
| `addToken(token, refresh?)` | Use existing token |
| `refreshAccessToken()` | Refresh expired token |
| `addMagnet(magnet)` | Add magnet link |
| `getVideos()` | List all video files (original behaviour) |
| `getContents()` | Root folders + files + space |
| `getFolder(id)` | Get one folder |
| `getFile(id)` | Get direct download URL for a **file** |
| `getDownloadUrl(id)` | Same as above (convenience) |
| `createArchive(folderId)` | Create ZIP of folder → returns `archive_url` |
| `getArchiveUrl(folderId)` | Convenience for archive download link |
| `deleteFile(id)` | Delete file |
| `deleteFolder(id)` | Delete folder |
| `rename(id, name, type)` | Rename file or folder |

## Example

```js
const Seedr = require("seedr");
const seedr = new Seedr();

(async () => {
  await seedr.login("email@example.com", "password");

  // Add torrent
  const add = await seedr.addMagnet("magnet:?xt=urn:btih:...");
  console.log(add);

  // List videos
  const videos = await seedr.getVideos();
  console.log(videos);

  // Get direct download link for a single file
  if (videos[0]?.[0]) {
    const file = await seedr.getFile(videos[0][0].id);
    console.log("File download:", file.url);
  }

  // Get archive (ZIP) download link for a whole folder
  // → https://www.seedr.cc/download/archive/...?token=...&exp=...
  const archive = await seedr.createArchive(videos[0][0].fid);
  console.log("Archive link:", archive.archive_url);
})();
```

## Notes

- Password login uses `client_id=seedr_chrome`
- Device code uses `client_id=seedr_xbmc` (longer token lifetime)
- Token refresh is supported if you keep the `refresh_token`
- Official Seedr REST API (Basic Auth / new OAuth) is separate and mostly Premium-only
- This wrapper uses the same unofficial endpoints that the old Chrome extension & Kodi addon used — they still respond correctly in 2026

## Changelog (1.2.0)

- Added proper error messages
- Added `refreshAccessToken()`
- Added `getContents()`, `getRoot()`, `getFolder()`, `rename()`
- Auto-retry once on 401 using refresh token
- Better FormData handling
- Cleaner code structure
