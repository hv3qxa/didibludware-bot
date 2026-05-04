// ═══════════════════════════════════════════════════════════════
//  DIDIBLUDWARE Key Bot + API Server
//  Commands:
//    .help          — list all commands
//    .key <hours>   — generate a key lasting <hours> hours (bot owner only)
//    .keys          — list all active keys with player info
//    .revoke <key>  — revoke a key immediately
//
//  The Express server exposes:
//    GET /validate?key=XXXX&roblox_user=NAME&roblox_id=ID&server_id=SID&local_time=TIME
//    GET /keys  — (protected) list all keys
// ═══════════════════════════════════════════════════════════════

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const express = require("express");
const fs      = require("fs");
const crypto  = require("crypto");
const path    = require("path");

// ── CONFIG ── edit these ────────────────────────────────────────
const CONFIG = {
  DISCORD_TOKEN   : process.env.DISCORD_TOKEN,
  OWNER_IDS       : [process.env.OWNER_ID],
  API_SECRET      : process.env.API_SECRET,
  API_PORT        : process.env.PORT || 3000,
  PREFIX          : ".",
  KEYS_FILE       : "./keys.json",
  KEY_LOGS_CHANNEL: "key-logs",
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

// Find the key-logs channel across all guilds
function findLogChannel(client) {
  for (const guild of client.guilds.cache.values()) {
    const ch = guild.channels.cache.find(
      c => c.name === CONFIG.KEY_LOGS_CHANNEL && c.isTextBased()
    );
    if (ch) return ch;
  }
  return null;
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

  // ── .help ─────────────────────────────────────────────────────
  if (command === "help") {
    const embed = new EmbedBuilder()
      .setColor(0x6432DC)
      .setTitle("📖 DIDIBLUDWARE Bot — Commands")
      .setDescription("All available commands for this bot.")
      .addFields(
        {
          name: "`.key <hours>`",
          value: "Generate a new key that lasts `<hours>` hours.\nExample: `.key 24` → 24-hour key\n**Owner only.**",
          inline: false,
        },
        {
          name: "`.keys`",
          value: "List all currently active keys, including claimed player info (Roblox user, ID, profile link) and time remaining.\n**Owner only.**",
          inline: false,
        },
        {
          name: "`.revoke <key>`",
          value: "Immediately revoke/delete an active key.\nExample: `.revoke DBW-XXXX-XXXX-XXXX`\n**Owner only.**",
          inline: false,
        },
        {
          name: "`.help`",
          value: "Shows this command list.",
          inline: false,
        },
        {
          name: "ℹ️ Key Stacking",
          value: "If a player already has an active key and redeems another, the **old key is deleted** and its remaining time is added onto the new key automatically.",
          inline: false,
        },
        {
          name: "📋 Redemption Logs",
          value: `All key redemptions are automatically logged to <#${CONFIG.KEY_LOGS_CHANNEL}> with the player's Roblox info, server ID, and local time.`,
          inline: false,
        }
      )
      .setFooter({ text: "DIDIBLUDWARE Key System" })
      .setTimestamp();

    return msg.reply({ embeds: [embed] });
  }

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
      claimed    : false,
      usedBy     : null,
      usedAt     : null,
      robloxUser : null,
      robloxId   : null,
      serverId   : null,
      localTime  : null,
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

    // Split into chunks if many keys (Discord embed description limit)
    const embeds = [];
    const chunkSize = 5;

    for (let i = 0; i < list.length; i += chunkSize) {
      const chunk = list.slice(i, i + chunkSize);
      const fields = chunk.map(([k, d]) => {
        const timeLeft = d.permanent ? "PERMANENT" : fmtMs(d.expiresAt - Date.now());
        const status   = d.claimed ? "✅ Claimed" : "⏳ Unclaimed";

        let playerInfo = "*Not yet redeemed*";
        if (d.claimed && d.robloxUser) {
          playerInfo =
            `👤 **${d.robloxUser}**\n` +
            `🆔 Roblox ID: \`${d.robloxId || "N/A"}\`\n` +
            `🔗 [Profile](https://www.roblox.com/users/${d.robloxId}/profile)\n` +
            `🖥️ Server: \`${d.serverId || "N/A"}\`\n` +
            `🕐 Redeemed: ${d.localTime || "N/A"}`;
        }

        return {
          name: `\`${k}\` — ${status} — ⏱ ${timeLeft}`,
          value: playerInfo,
          inline: false,
        };
      });

      const embed = new EmbedBuilder()
        .setColor(0x6432DC)
        .setTitle(i === 0 ? `🗝️ Active Keys (${list.length})` : `🗝️ Active Keys (cont.)`)
        .addFields(fields)
        .setTimestamp();

      embeds.push(embed);
    }

    return msg.reply({ embeds: embeds.slice(0, 10) }); // Discord max 10 embeds per message
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
  GET /validate?key=DBW-XXXX&roblox_user=NAME&roblox_id=ID&server_id=SID&local_time=TIME

  Key stacking logic:
    - If the player already has an active key (matched by roblox_id), that key
      is deleted and its remaining time is added to the new key being redeemed.

  Response JSON:
    { valid: true,  permanent: false, expiresAt: 1234567890000, timeLeftMs: ... }
    { valid: false, reason: "expired" | "invalid" | "missing_params" }
*/
app.get("/validate", async (req, res) => {
  const keyStr     = (req.query.key         || "").toUpperCase().trim();
  const robloxUser = (req.query.roblox_user || "").trim();
  const robloxId   = (req.query.roblox_id   || "").trim();
  const serverId   = (req.query.server_id   || "").trim();
  const localTime  = (req.query.local_time  || "").trim();

  if (!keyStr) {
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

  // ── Key Stacking ──────────────────────────────────────────────
  // If this player already owns another active key, delete it and
  // carry its remaining time over into the new key.
  let bonusMs = 0;
  if (robloxId) {
    for (const [existingKey, existingData] of Object.entries(keys)) {
      if (
        existingKey !== keyStr &&
        existingData.claimed &&
        existingData.robloxId === robloxId &&
        !existingData.permanent &&
        existingData.expiresAt > now
      ) {
        bonusMs = Math.max(0, existingData.expiresAt - now);
        delete keys[existingKey];
        console.log(`[Stacking] Removed old key ${existingKey} for ${robloxUser}, carrying ${bonusMs}ms`);
        break;
      }
    }
  }

  // ── First-time claim ──────────────────────────────────────────
  if (!data.claimed) {
    data.claimed    = true;
    data.claimedAt  = now;
    data.expiresAt  = now + data.durationMs + bonusMs;  // add stacked time
    data.robloxUser = robloxUser || null;
    data.robloxId   = robloxId   || null;
    data.serverId   = serverId   || null;
    data.localTime  = localTime  || null;
    keys[keyStr]    = data;
    saveKeys(keys);

    // ── Log to #key-logs ─────────────────────────────────────────
    try {
      const logChannel = findLogChannel(client);
      if (logChannel) {
        const profileUrl = robloxId
          ? `https://www.roblox.com/users/${robloxId}/profile`
          : null;

        const stackNote = bonusMs > 0
          ? `\n⏫ **Stacked** — Added \`${fmtMs(bonusMs)}\` from previous key`
          : "";

        const logEmbed = new EmbedBuilder()
          .setColor(0x00FF99)
          .setTitle("🔑 Key Redeemed")
          .addFields(
            { name: "Key",          value: `\`${keyStr}\``,                              inline: false },
            { name: "Roblox User",  value: robloxUser  || "Unknown",                    inline: true  },
            { name: "Roblox ID",    value: robloxId    || "Unknown",                    inline: true  },
            { name: "Profile",      value: profileUrl  ? `[View Profile](${profileUrl})` : "N/A", inline: true },
            { name: "Server ID",    value: serverId    || "Unknown",                    inline: true  },
            { name: "Local Time",   value: localTime   || "Unknown",                    inline: true  },
            { name: "Expires In",   value: fmtMs(data.expiresAt - now),                 inline: true  },
          )
          .setDescription(stackNote || null)
          .setFooter({ text: "DIDIBLUDWARE Key System" })
          .setTimestamp();

        await logChannel.send({ embeds: [logEmbed] });
      } else {
        console.warn(`[Bot] Could not find #${CONFIG.KEY_LOGS_CHANNEL} channel.`);
      }
    } catch (err) {
      console.error("[Bot] Failed to send key log:", err);
    }
  }

  const timeLeftMs = data.permanent ? null : Math.max(0, data.expiresAt - now);

  return res.json({
    valid      : true,
    permanent  : !!data.permanent,
    expiresAt  : data.expiresAt || null,
    timeLeftMs : timeLeftMs,
    stacked    : bonusMs > 0,
    stackedMs  : bonusMs,
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