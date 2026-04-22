// ═══════════════════════════════════════════════════════════════
//  DIDIBLUDWARE Key Bot + API Server
//  Commands:
//    .key <hours>   — generate a key lasting <hours> hours (bot owner only)
//    .keys          — list all active keys
//    .revoke <key>  — revoke a key immediately
//
//  The Express server exposes:
//    GET /validate?key=XXXX&player=NAME  — called by the Lua script
//    GET /keys                           — (protected) list all keys
// ═══════════════════════════════════════════════════════════════

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const express = require("express");
const fs      = require("fs");
const crypto  = require("crypto");
const path    = require("path");

const CONFIG = {
  DISCORD_TOKEN : process.env.DISCORD_TOKEN,
  OWNER_IDS     : JSON.parse(process.env.OWNER_IDS || "[]"),
  API_PORT      : process.env.PORT || 3000,
  API_SECRET    : process.env.API_SECRET || "changeme",
  PREFIX        : ".",
  KEYS_FILE     : "./keys.json",
};
// ───────────────────────────────────────────────────────────────

// ── Key storage helpers ─────────────────────────────────────────
function loadKeys() {
  if (!fs.existsSync(CONFIG.KEYS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG.KEYS_FILE, "utf8")); }
  catch { return {}; }
}

function saveKeys(keys) {
  fs.writeFileSync(CONFIG.KEYS_FILE, JSON.stringify(keys, null, 2));
}

// Remove expired keys and used-up keys, return cleaned store
function cleanKeys(keys) {
  const now = Date.now();
  for (const [key, data] of Object.entries(keys)) {
    if (!data.permanent && data.expiresAt <= now) {
      delete keys[key];
    }
  }
  return keys;
}

// Generate a random key string  e.g.  DBW-A3F2-91BC-44D0
function generateKey() {
  const seg = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `DBW-${seg()}-${seg()}-${seg()}`;
}

// Format ms remaining into a readable string
function fmtMs(ms) {
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(" ") : "<1m";
}

// ── Discord Bot ─────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  console.log(`[API] Listening on port ${CONFIG.API_PORT}`);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith(CONFIG.PREFIX)) return;

  const args    = msg.content.slice(CONFIG.PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  const isOwner = CONFIG.OWNER_IDS.includes(msg.author.id);

  // ── .key <hours> ──────────────────────────────────────────────
  if (command === "key") {
    if (!isOwner) {
      return msg.reply("❌ You don't have permission to generate keys.");
    }

    const hours = parseFloat(args[0]);
    if (!args[0] || isNaN(hours) || hours <= 0) {
      return msg.reply("❌ Usage: `.key <hours>`  e.g. `.key 24`");
    }

    const keys      = cleanKeys(loadKeys());
    const newKey    = generateKey();
    const expiresAt = Date.now() + hours * 3600 * 1000;

    keys[newKey] = {
      createdAt  : Date.now(),
      expiresAt  : expiresAt,
      durationMs : hours * 3600 * 1000,
      permanent  : false,
      usedBy     : null,   // null = not yet claimed
      usedAt     : null,
    };
    saveKeys(keys);

    const embed = new EmbedBuilder()
      .setColor(0x6432DC)
      .setTitle("🔑 Key Generated")
      .addFields(
        { name: "Key",      value: `\`${newKey}\``,         inline: false },
        { name: "Duration", value: `${hours} hour(s)`,      inline: true  },
        { name: "Expires",  value: fmtMs(hours * 3600000),  inline: true  },
        { name: "Uses",     value: "1 (single use)",        inline: true  }
      )
      .setFooter({ text: "Key timer starts when first activated in-game" })
      .setTimestamp();

    return msg.reply({ embeds: [embed] });
  }

  // ── .keys ─────────────────────────────────────────────────────
  if (command === "keys") {
    if (!isOwner) return msg.reply("❌ No permission.");

    const keys  = cleanKeys(loadKeys());
    const list  = Object.entries(keys);

    if (list.length === 0) {
      return msg.reply("📭 No active keys.");
    }

    const lines = list.map(([k, d]) => {
      const status = d.usedBy
        ? `Used by \`${d.usedBy}\``
        : "Unclaimed";
      const timeLeft = d.permanent
        ? "PERMANENT"
        : fmtMs(d.expiresAt - Date.now());
      return `\`${k}\` — ${status} — ⏱ ${timeLeft}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x6432DC)
      .setTitle(`🗝️ Active Keys (${list.length})`)
      .setDescription(lines.join("\n"))
      .setTimestamp();

    return msg.reply({ embeds: [embed] });
  }

  // ── .revoke <key> ─────────────────────────────────────────────
  if (command === "revoke") {
    if (!isOwner) return msg.reply("❌ No permission.");
    if (!args[0])  return msg.reply("❌ Usage: `.revoke <key>`");

    const keys = loadKeys();
    const k    = args[0].toUpperCase();

    if (!keys[k]) return msg.reply("❌ Key not found.");

    delete keys[k];
    saveKeys(keys);
    return msg.reply(`✅ Key \`${k}\` has been revoked.`);
  }
});

// ── Express API (called by Lua script) ─────────────────────────
const app = express();

/*
  GET /validate?key=DBW-XXXX-XXXX-XXXX&player=PlayerName
  Response JSON:
    { valid: true,  permanent: false, expiresAt: 1234567890000, timeLeftMs: 86400000 }
    { valid: false, reason: "expired" | "invalid" | "already_used_by_other" }
*/
app.get("/validate", (req, res) => {
  const keyStr = (req.query.key    || "").toUpperCase().trim();
  const player = (req.query.player || "").trim();

  if (!keyStr || !player) {
    return res.json({ valid: false, reason: "missing_params" });
  }

  const keys = cleanKeys(loadKeys());

  if (!keys[keyStr]) {
    return res.json({ valid: false, reason: "invalid" });
  }

  const data = keys[keyStr];
  const now  = Date.now();

  // Expired?
  if (!data.permanent && data.expiresAt <= now) {
    delete keys[keyStr];
    saveKeys(keys);
    return res.json({ valid: false, reason: "expired" });
  }

  // Already claimed by a DIFFERENT player?
  if (data.usedBy && data.usedBy.toLowerCase() !== player.toLowerCase()) {
    return res.json({ valid: false, reason: "already_used_by_other" });
  }

  // First-time claim — bind key to this player and start the timer NOW
  if (!data.usedBy) {
    data.usedBy  = player;
    data.usedAt  = now;
    // Reset expiresAt to be relative to first use
    data.expiresAt = now + data.durationMs;
    keys[keyStr]   = data;
    saveKeys(keys);
  }

  const timeLeftMs = data.permanent ? null : Math.max(0, data.expiresAt - now);

  return res.json({
    valid      : true,
    permanent  : !!data.permanent,
    expiresAt  : data.expiresAt || null,
    timeLeftMs : timeLeftMs,
  });
});

// Admin endpoint to list keys (requires secret header)
app.get("/keys", (req, res) => {
  if (req.headers["x-secret"] !== CONFIG.API_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const keys = cleanKeys(loadKeys());
  res.json(keys);
});

app.listen(CONFIG.API_PORT, () => {
  console.log(`[API] Server running on http://localhost:${CONFIG.API_PORT}`);
});

client.login(CONFIG.DISCORD_TOKEN);
