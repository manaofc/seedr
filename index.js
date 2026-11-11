"use strict";

const https = require("https");

/**
 * Unofficial Seedr.cc API wrapper
 * 𝐬𝐞𝐞𝐝𝐫.𝐜𝐜
 */

const BASE = "https://www.seedr.cc";
const OAUTH_TOKEN = `${BASE}/oauth_test/token.php`;
const OAUTH_RESOURCE = `${BASE}/oauth_test/resource.php`;

// One shared keep-alive agent → TCP/TLS handshake is paid once, not per request
const agent = new https.Agent({ keepAlive: true, maxSockets: 16 });

// Load manaofc-node-fetch once and cache the promise
let fetchLib = null;
function loadFetch() {
  if (!fetchLib) fetchLib = import("manaofc-node-fetch");
  return fetchLib;
}

/**
 * Low-level request. Returns { ok, status, data } and never throws on HTTP
 * errors (fetch doesn't, unlike axios) — callers decide what to do.
 * @param {string} url
 * @param {Array<[string, any]>} [fields] if given → multipart POST
 */
async function request(url, fields) {
  const { default: fetch, FormData } = await loadFetch();
  const init = { agent };

  if (fields) {
    const form = new FormData();
    for (const [key, value] of fields) form.append(key, String(value));
    init.method = "POST";
    init.body = form; // multipart boundary/header is set automatically
  }

  const res = await fetch(url, init);
  const text = await res.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

/** Pull a human-readable error out of a response (or null if none) */
function errorMessage(res) {
  return (
    res.data?.error_description ||
    res.data?.error ||
    (res.ok ? null : `HTTP ${res.status}`)
  );
}

class Seedr {
  constructor() {
    this.token = null;
    this.refreshToken = null;
    this.username = null;
    this.password = null;
    this._refreshing = null; // shared in-flight refresh (avoids refresh storms)
  }

  /**
   * Login with email + password (short-lived token)
   * Uses seedr_chrome client_id
   */
  async login(username, password) {
    this.username = username;
    this.password = password;

    let res;
    try {
      res = await request(OAUTH_TOKEN, [
        ["grant_type", "password"],
        ["client_id", "seedr_chrome"],
        ["type", "login"],
        ["username", username],
        ["password", password],
      ]);
    } catch (err) {
      throw new Error(`Login failed: ${err.message}`);
    }

    const error = errorMessage(res);
    if (error) throw new Error(`Login failed: ${error}`);

    this.token = res.data.access_token;
    this.refreshToken = res.data.refresh_token || null;
    return this.token;
  }

  /**
   * Get device code for long-lived (≈1 year) token
   * User must go to https://www.seedr.cc/devices and enter the user_code
   */
  async getDeviceCode() {
    let res;
    try {
      res = await request(`${BASE}/api/device/code?client_id=seedr_xbmc`);
    } catch (err) {
      throw new Error(`getDeviceCode failed: ${err.message}`);
    }

    const error = errorMessage(res);
    if (error) throw new Error(`getDeviceCode failed: ${error}`);

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
  }

  /**
   * Exchange device_code for access token (call after user authorizes)
   */
  async getToken(deviceCode) {
    const code = deviceCode || this.devc;
    if (!code) throw new Error("device_code is required");

    let res;
    try {
      res = await request(
        `${BASE}/api/device/authorize?device_code=${encodeURIComponent(
          code
        )}&client_id=seedr_xbmc`
      );
    } catch (err) {
      throw new Error(`getToken failed: ${err.message}`);
    }

    const error = errorMessage(res);
    if (error) throw new Error(`getToken failed: ${error}`);

    this.token = res.data.access_token;
    this.refreshToken = res.data.refresh_token || null;
    return this.token;
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

    let res;
    try {
      res = await request(OAUTH_TOKEN, [
        ["grant_type", "refresh_token"],
        ["refresh_token", this.refreshToken],
        ["client_id", "seedr_chrome"],
      ]);
    } catch (err) {
      throw new Error(`Token refresh failed: ${err.message}`);
    }

    const error = errorMessage(res);
    if (error) throw new Error(`Token refresh failed: ${error}`);

    this.token = res.data.access_token;
    if (res.data.refresh_token) this.refreshToken = res.data.refresh_token;
    return this.token;
  }

  /**
   * Internal – run an authenticated request, auto-refreshing the token once
   * if it expired. Concurrent callers share a single refresh.
   * @param {() => Promise<{ok:boolean,status:number,data:any}>} send
   */
  async _authed(send) {
    if (!this.token) {
      throw new Error("Not logged in. Call login() or addToken() first.");
    }

    let res = await send();

    const expired =
      res.status === 401 || res.data?.error === "access_denied";

    if (expired && this.refreshToken) {
      if (!this._refreshing) {
        this._refreshing = this.refreshAccessToken().finally(() => {
          this._refreshing = null;
        });
      }
      await this._refreshing;
      res = await send(); // `send` reads this.token again → uses the new one
    }

    if (!res.ok) {
      throw new Error(errorMessage(res) || `HTTP ${res.status}`);
    }
    return res.data;
  }

  /**
   * Internal helper – authenticated POST to resource.php
   */
  _resource(func, extra = {}) {
    return this._authed(() => {
      const fields = [
        ["access_token", this.token],
        ["func", func],
      ];
      for (const [key, value] of Object.entries(extra)) {
        fields.push([
          key,
          typeof value === "object" ? JSON.stringify(value) : value,
        ]);
      }
      return request(OAUTH_RESOURCE, fields);
    });
  }

  /**
   * Internal helper – authenticated GET to /api/*
   */
  _get(path) {
    return this._authed(() =>
      request(`${BASE}/api/${path}?access_token=${encodeURIComponent(this.token)}`)
    );
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
    return this._get("folder");
  }

  /**
   * Get folder by id
   */
  async getFolder(folderId) {
    return this._get(`folder/${encodeURIComponent(folderId)}`);
  }

  /**
   * Get all video files (same as original getVideos)
   * Returns array of arrays (one per folder).
   * Folders are fetched in parallel (was one-by-one before).
   */
  async getVideos() {
    const root = await this.getRoot();

    const folders = await Promise.all(
      (root.folders || []).map(async (folder) => ({
        folder,
        data: await this.getFolder(folder.id),
      }))
    );

    const result = [];
    for (const { folder, data } of folders) {
      const videos = (data.files || [])
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
