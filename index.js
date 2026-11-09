const axios = require("axios");
const FormData = require("form-data");

/**
 * Unofficial Seedr.cc API wrapper
 * Updated & fixed — endpoints still work (oauth_test + chrome/xbmc client ids)
 */
class Seedr {
  constructor() {
    this.token = null;
    this.refreshToken = null;
    this.username = null;
    this.password = null;
  }

  /**
   * Login with email + password (short-lived token)
   * Uses seedr_chrome client_id
   */
  async login(username, password) {
    this.username = username;
    this.password = password;

    const data = new FormData();
    data.append("grant_type", "password");
    data.append("client_id", "seedr_chrome");
    data.append("type", "login");
    data.append("username", username);
    data.append("password", password);

    try {
      const res = await axios.post(
        "https://www.seedr.cc/oauth_test/token.php",
        data,
        { headers: data.getHeaders() }
      );

      if (res.data.error) {
        throw new Error(res.data.error_description || res.data.error);
      }

      this.token = res.data.access_token;
      this.refreshToken = res.data.refresh_token || null;
      return this.token;
    } catch (err) {
      const msg =
        err.response?.data?.error_description ||
        err.response?.data?.error ||
        err.message;
      throw new Error(`Login failed: ${msg}`);
    }
  }

  /**
   * Get device code for long-lived (≈1 year) token
   * User must go to https://www.seedr.cc/devices and enter the user_code
   */
  async getDeviceCode() {
    try {
      const res = await axios.get(
        "https://www.seedr.cc/api/device/code?client_id=seedr_xbmc"
      );

      this.devc = res.data.device_code;
      this.usc = res.data.user_code;
      this.verificationUrl =
        res.data.verification_url || "https://www.seedr.cc/devices";

      console.log(
        `Go to ${this.verificationUrl} and enter this code: ${this.usc}`
      );
      console.log(`(device_code: ${this.devc})`);

      return {
        user_code: this.usc,
        device_code: this.devc,
        verification_url: this.verificationUrl,
        expires_in: res.data.expires_in,
        interval: res.data.interval,
      };
    } catch (err) {
      throw new Error(`getDeviceCode failed: ${err.message}`);
    }
  }

  /**
   * Exchange device_code for access token (call after user authorizes)
   */
  async getToken(deviceCode) {
    const code = deviceCode || this.devc;
    if (!code) throw new Error("device_code is required");

    try {
      const res = await axios.get(
        `https://www.seedr.cc/api/device/authorize?device_code=${code}&client_id=seedr_xbmc`
      );

      if (res.data.error) {
        throw new Error(res.data.error_description || res.data.error);
      }

      this.token = res.data.access_token;
      this.refreshToken = res.data.refresh_token || null;
      return this.token;
    } catch (err) {
      const msg =
        err.response?.data?.error_description ||
        err.response?.data?.error ||
        err.message;
      throw new Error(`getToken failed: ${msg}`);
    }
  }

  /**
   * Set token manually (from previous session)
   */
  async addToken(token, refreshToken = null) {
    this.token = token;
    if (refreshToken) this.refreshToken = refreshToken;
  }

  /**
   * Refresh access token using refresh_token
   */
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error("No refresh_token available. Login again.");
    }

    const data = new FormData();
    data.append("grant_type", "refresh_token");
    data.append("refresh_token", this.refreshToken);
    data.append("client_id", "seedr_chrome");

    try {
      const res = await axios.post(
        "https://www.seedr.cc/oauth_test/token.php",
        data,
        { headers: data.getHeaders() }
      );

      if (res.data.error) {
        throw new Error(res.data.error_description || res.data.error);
      }

      this.token = res.data.access_token;
      if (res.data.refresh_token) {
        this.refreshToken = res.data.refresh_token;
      }
      return this.token;
    } catch (err) {
      const msg =
        err.response?.data?.error_description ||
        err.response?.data?.error ||
        err.message;
      throw new Error(`Token refresh failed: ${msg}`);
    }
  }

  /**
   * Internal helper – make authenticated request to resource.php
   */
  async _resource(func, extra = {}) {
    if (!this.token) throw new Error("Not logged in. Call login() or addToken() first.");

    const data = new FormData();
    data.append("access_token", this.token);
    data.append("func", func);

    for (const [key, value] of Object.entries(extra)) {
      data.append(key, typeof value === "object" ? JSON.stringify(value) : value);
    }

    try {
      const res = await axios.post(
        "https://www.seedr.cc/oauth_test/resource.php",
        data,
        { headers: data.getHeaders() }
      );
      return res.data;
    } catch (err) {
      // Auto-refresh once if token expired
      if (
        this.refreshToken &&
        (err.response?.status === 401 ||
          err.response?.data?.error === "access_denied")
      ) {
        await this.refreshAccessToken();
        // retry once
        const data2 = new FormData();
        data2.append("access_token", this.token);
        data2.append("func", func);
        for (const [key, value] of Object.entries(extra)) {
          data2.append(key, typeof value === "object" ? JSON.stringify(value) : value);
        }
        const res2 = await axios.post(
          "https://www.seedr.cc/oauth_test/resource.php",
          data2,
          { headers: data2.getHeaders() }
        );
        return res2.data;
      }
      throw err;
    }
  }

  /**
   * Add magnet link
   */
  async addMagnet(magnet) {
    if (!magnet || !magnet.startsWith("magnet:")) {
      throw new Error("Invalid magnet link");
    }
    return this._resource("add_torrent", { torrent_magnet: magnet });
  }

  /**
   * Get root folder contents
   */
  async getRoot() {
    if (!this.token) throw new Error("Not logged in");
    const res = await axios.get(
      `https://www.seedr.cc/api/folder?access_token=${this.token}`
    );
    return res.data;
  }

  /**
   * Get folder by id
   */
  async getFolder(folderId) {
    if (!this.token) throw new Error("Not logged in");
    const res = await axios.get(
      `https://www.seedr.cc/api/folder/${folderId}?access_token=${this.token}`
    );
    return res.data;
  }

  /**
   * Get all video files (same as original getVideos)
   * Returns array of arrays (one per folder)
   */
  async getVideos() {
    const root = await this.getRoot();
    const result = [];

    for (const folder of root.folders || []) {
      const folderData = await this.getFolder(folder.id);
      const videos = (folderData.files || [])
        .filter((f) => f.play_video)
        .map((f) => ({
          fid: folder.id,
          id: f.folder_file_id,
          name: f.name,
          size: f.size,
        }));
      if (videos.length) result.push(videos);
    }

    return result;
  }

  /**
   * Get all files + folders (flat-ish structure)
   */
  async getContents() {
    const root = await this.getRoot();
    return {
      folders: root.folders || [],
      files: root.files || [],
      torrents: root.torrents || [],
      space_used: root.space_used,
      space_max: root.space_max,
    };
  }

  /**
   * Fetch download / stream info for a single file
   * Returns { result, url, name } — url is a direct download link
   */
  async getFile(fileId) {
    return this._resource("fetch_file", { folder_file_id: fileId });
  }

  /**
   * Create a ZIP archive of a folder and get download link
   * This is the link format you asked about:
   * https://www.seedr.cc/download/archive/...?token=...&exp=...
   *
   * @param {string|number} folderId
   * @returns {Promise<{result: boolean, archive_id?: number, archive_url?: string}>}
   */
  async createArchive(folderId) {
    // API expects: archive_arr = [{"type":"folder","id":123}]
    return this._resource("create_empty_archive", {
      archive_arr: [{ type: "folder", id: Number(folderId) }],
    });
  }

  /**
   * Convenience: get direct download URL for a file
   */
  async getDownloadUrl(fileId) {
    const res = await this.getFile(fileId);
    return res.url || res.download_url || null;
  }

  /**
   * Convenience: get archive download URL for a folder
   */
  async getArchiveUrl(folderId) {
    const res = await this.createArchive(folderId);
    return res.archive_url || null;
  }

  /**
   * Delete a file
   */
  async deleteFile(fileId) {
    return this._resource("delete", {
      delete_arr: [{ type: "file", id: fileId }],
    });
  }

  /**
   * Delete a folder
   */
  async deleteFolder(folderId) {
    return this._resource("delete", {
      delete_arr: [{ type: "folder", id: folderId }],
    });
  }

  /**
   * Rename file or folder
   */
  async rename(id, name, type = "file") {
    // type: "file" | "folder"
    return this._resource("rename", {
      rename_id: id,
      rename_to: name,
      rename_type: type,
    });
  }
}

module.exports = Seedr;
