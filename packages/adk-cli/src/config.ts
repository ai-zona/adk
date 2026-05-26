// ──────────────────────────────────────────────────────
// CLI Config Manager
// Stores config in ~/.aizona/config.json + credentials.json
// ──────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CLIConfig {
  apiUrl?: string;
  defaultTemplate?: string;
}

export interface CLICredentials {
  apiKey?: string;
}

/** Get the config directory (~/.aizona) */
export function getConfigDir(): string {
  return path.join(os.homedir(), ".aizona");
}

/** Ensure config directory exists */
function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Read config from ~/.aizona/config.json */
export function readConfig(): CLIConfig {
  try {
    const configPath = path.join(getConfigDir(), "config.json");
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

/** Write config to ~/.aizona/config.json */
export function writeConfig(config: CLIConfig): void {
  ensureConfigDir();
  const configPath = path.join(getConfigDir(), "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/** Read credentials from ~/.aizona/credentials.json */
function readCredentials(): CLICredentials {
  try {
    const credPath = path.join(getConfigDir(), "credentials.json");
    if (!fs.existsSync(credPath)) return {};
    return JSON.parse(fs.readFileSync(credPath, "utf-8"));
  } catch {
    return {};
  }
}

/** Write credentials to ~/.aizona/credentials.json */
function writeCredentials(creds: CLICredentials): void {
  ensureConfigDir();
  const credPath = path.join(getConfigDir(), "credentials.json");
  fs.writeFileSync(credPath, JSON.stringify(creds, null, 2), { encoding: "utf-8", mode: 0o600 });
  // Ensure restrictive permissions on Unix systems
  try {
    fs.chmodSync(credPath, 0o600);
  } catch {
    // chmodSync may fail on Windows — ignore
  }
}

// ──────────────────────────────────────────────────────
// API Key Encryption (machine-derived key)
// ──────────────────────────────────────────────────────

function getMachineKey(): Buffer {
  const material = `${os.hostname()}-${os.userInfo().username}-aizona-cli`;
  return createHash("sha256").update(material).digest();
}

export function encryptApiKey(key: string): string {
  const machineKey = getMachineKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", machineKey, iv);
  const encrypted = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptApiKey(encrypted: string): string {
  const machineKey = getMachineKey();
  const data = Buffer.from(encrypted, "base64");
  const iv = data.subarray(0, 16);
  const tag = data.subarray(16, 32);
  const enc = data.subarray(32);
  const decipher = createDecipheriv("aes-256-gcm", machineKey, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc, undefined, "utf8") + decipher.final("utf8");
}

/** Get the current API key (from env var or stored credentials) */
export function getApiKey(): string | undefined {
  if (process.env.AIZONA_API_KEY) {
    return process.env.AIZONA_API_KEY;
  }
  const stored = readCredentials().apiKey;
  if (!stored) return undefined;
  try {
    return decryptApiKey(stored);
  } catch {
    // Fallback: handle unencrypted legacy keys gracefully
    return stored;
  }
}

/** Store an API key in credentials (encrypted) */
export function setApiKey(key: string): void {
  const creds = readCredentials();
  creds.apiKey = encryptApiKey(key);
  writeCredentials(creds);
}

/** Get the API URL (from config or default) */
export function getApiUrl(): string {
  return readConfig().apiUrl ?? process.env.AIZONA_API_URL ?? "http://localhost:3456";
}
