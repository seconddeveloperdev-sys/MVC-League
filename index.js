const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  REST,
  Routes,
  ThreadAutoArchiveDuration,
  PermissionFlagsBits,
} = require("discord.js");

const fs = require("fs");

// ─── Config ───────────────────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const LEAGUE_CHANNEL_ID = "1462387975022186621";
const LEAGUE_HOST_ROLE_ID = "1500064722312233050";
const LEAGUES_PING_ROLE_ID = "1500068561174003853";
const TRYOUT_MANAGER_ROLE_ID = "1491729945062277220";

const DB_PATH = "./database.json";

// ─── Spam Config ──────────────────────────────────────────────────────────────
const SPAM_LIMIT = 5;        // messages allowed per window
const SPAM_WINDOW = 5000;    // ms — rolling window
const WARN_COOLDOWN = 15000; // ms — how often to warn the same user
const spamMap = new Map();   // userId -> { timestamps, contents, warnedAt }

// ─── Database ─────────────────────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const def = { leagues: {}, giveaways: {}, tournaments: {}, tryouts: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(def, null, 2));
    return def;
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (!data.giveaways) data.giveaways = {};
  if (!data.tournaments) data.tournaments = {};
  if (!data.tryouts) data.tryouts = {};
  return data;
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function uniqueId(collection) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id;
  do {
    id = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (collection[id]);
  return id;
}

// ─── League ───────────────────────────────────────────────────────────────────
function getMaxPlayers(format) {
  return parseInt(format.charAt(0)) * 2;
}

function buildLeagueEmbed(league) {
  const spotsLeft = league.maxPlayers - league.players.length;
  const playerList = league.players.length > 0
    ? league.players.map((p) => `<@${p}>`).join("\n")
    : "None";

  return new EmbedBuilder()
    .setTitle("League Available")
    .setColor(0x5865f2)
    .addFields(
      { name: "Format", value: league.format, inline: true },
      { name: "Match Type", value: league.matchType, inline: true },
      { name: "Perks", value: league.perks, inline: true },
      { name: "Region", value: league.region, inline: true },
      { name: "Host", value: `<@${league.hostId}>`, inline: true },
      { name: "Spots Left", value: `${spotsLeft} / ${league.maxPlayers}`, inline: true },
      { name: "Players", value: playerList, inline: false },
      { name: "League ID", value: `\`${league.id}\``, inline: false }
    )
    .setFooter({ text: `Cancel: /league cancel id:${league.id}` })
    .setTimestamp();
}

function buildJoinRow(leagueId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_league_${leagueId}`)
      .setLabel("Join League")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

// ─── Giveaway ─────────────────────────────────────────────────────────────────
const giveawayTimers = new Map();

function buildGiveawayEmbed(giveaway) {
  const unixEnd = Math.floor(new Date(giveaway.endsAt).getTime() / 1000);
  return new EmbedBuilder()
    .setTitle("Giveaway")
    .setColor(0xfaa61a)
    .addFields(
      { name: "Prize", value: giveaway.prize, inline: false },
      { name: "Winners", value: `${giveaway.winners}`, inline: true },
      { name: "Ends", value: `<t:${unixEnd}:R>`, inline: true },
      { name: "Hosted By", value: `<@${giveaway.hostId}>`, inline: true }
    )
    .setFooter({ text: "React with 🎉 to enter" })
    .setTimestamp();
}

async function endGiveaway(giveawayId, client) {
  const db = loadDB();
  const giveaway = db.giveaways[giveawayId];
  if (!giveaway || !giveaway.active) return;

  db.giveaways[giveawayId].active = false;
  saveDB(db);
  giveawayTimers.delete(giveawayId);

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const msg = await channel.messages.fetch(giveaway.messageId);
    const reaction = msg.reactions.cache.get("🎉");

    let entries = [];
    if (reaction) {
      const users = await reaction.users.fetch();
      entries = users.filter((u) => !u.bot).map((u) => u.id);
    }

    const winnerCount = Math.min(giveaway.winners, entries.length);
    const winners = [...entries].sort(() => Math.random() - 0.5).slice(0, winnerCount);

    const endEmbed = new EmbedBuilder()
      .setTitle("Giveaway Ended")
      .setColor(0xed4245)
      .addFields(
        { name: "Prize", value: giveaway.prize, inline: false },
        {
          name: "Winners",
          value: winners.length > 0
            ? winners.map((w) => `<@${w}>`).join(", ")
            : "No valid entries.",
          inline: false,
        },
        { name: "Total Entries", value: `${entries.length}`, inline: true },
        { name: "Hosted By", value: `<@${giveaway.hostId}>`, inline: true }
      )
      .setTimestamp();

    await msg.edit({ embeds: [endEmbed] });

    if (winners.length > 0) {
      await channel.send(
        `Congratulations ${winners.map((w) => `<@${w}>`).join(", ")}! You have won the **${giveaway.prize}** giveaway.`
      );
    } else {
      await channel.send(
        `The giveaway for **${giveaway.prize}** has ended. No valid entries were found.`
      );
    }
  } catch (err) {
    console.error("Giveaway end error:", err.message);
  }
}

function scheduleGiveaway(giveaway, client) {
  const delay = Math.max(new Date(giveaway.endsAt).getTime() - Date.now(), 0);
  const timer = setTimeout(() => endGiveaway(giveaway.id, client), delay);
  giveawayTimers.set(giveaway.id, timer);
}

// ─── Tournament ───────────────────────────────────────────────────────────────
const TOURNAMENT_RULES = [
  "**Tournament Disclaimers**",
  "",
  "- Any accusations of cheating (dash tech, glitching or exploiting) must be backed up with a clip",
  "- Don't enter with people who can't / don't wish to play with you",
  "- Don't enter if you won't be available for your matches",
  "- This is a flash tournament, you must be ready to complete your match as soon as possible",
  "",
  "To enter, please head over to tournament entries and sign yourself up along with your teammate or yourself!",
].join("\n");

function buildTournamentEmbed(tournament) {
  const fields = [
    { name: "Type", value: tournament.type, inline: true },
    { name: "FT", value: `First to ${tournament.ft}`, inline: true },
    { name: "Prize", value: tournament.prize, inline: true },
    { name: "Hosted By", value: `<@${tournament.hostId}>`, inline: true },
  ];

  if (tournament.bannedMap) {
    fields.push({ name: "Banned Map", value: tournament.bannedMap, inline: true });
  }

  fields.push({ name: "\u200b", value: "\u200b", inline: false });
  fields.push({ name: "Rules", value: TOURNAMENT_RULES, inline: false });

  return new EmbedBuilder()
    .setTitle("Tournament")
    .setColor(0xe67e22)
    .addFields(...fields)
    .setFooter({ text: `Tournament ID: ${tournament.id}` })
    .setTimestamp();
}

function buildTournamentRow(tournament) {
  if (!tournament.serverLink) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Join Server")
      .setStyle(ButtonStyle.Link)
      .setURL(tournament.serverLink)
  );
}

// ─── Command Registration ─────────────────────────────────────────────────────
async function registerCommands() {
  const commands = [
    // /league
    new SlashCommandBuilder()
      .setName("league")
      .setDescription("League management commands")
      .addSubcommand((sub) =>
        sub.setName("host").setDescription("Host a new league")
          .addStringOption((opt) =>
            opt.setName("format").setDescription("Match format").setRequired(true)
              .addChoices(
                { name: "2v2", value: "2v2" },
                { name: "3v3", value: "3v3" },
                { name: "4v4", value: "4v4" }
              )
          )
          .addStringOption((opt) =>
            opt.setName("match_type").setDescription("Match type").setRequired(true)
              .addChoices(
                { name: "Swift Game", value: "Swift Game" },
                { name: "War Game", value: "War Game" }
              )
          )
          .addStringOption((opt) =>
            opt.setName("perks").setDescription("Match perks").setRequired(true)
              .addChoices(
                { name: "Perks", value: "Perks" },
                { name: "No Perks", value: "No Perks" }
              )
          )
          .addStringOption((opt) =>
            opt.setName("region").setDescription("Region").setRequired(true)
              .addChoices(
                { name: "Europe", value: "Europe" },
                { name: "Asia", value: "Asia" },
                { name: "North America", value: "North America" },
                { name: "South America", value: "South America" },
                { name: "Oceania", value: "Oceania" }
              )
          )
      )
      .addSubcommand((sub) =>
        sub.setName("cancel").setDescription("Cancel an active league")
          .addStringOption((opt) =>
            opt.setName("id").setDescription("The League ID to cancel").setRequired(true)
          )
      )
      .toJSON(),

    // /tryout
    new SlashCommandBuilder()
      .setName("tryout")
      .setDescription("Submit a tryout ticket")
      .addStringOption((opt) =>
        opt.setName("username").setDescription("Your in-game username").setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("platform").setDescription("Your platform").setRequired(true)
          .addChoices(
            { name: "PC", value: "PC" },
            { name: "PlayStation", value: "PlayStation" },
            { name: "Xbox", value: "Xbox" },
            { name: "Mobile", value: "Mobile" }
          )
      )
      .addStringOption((opt) =>
        opt.setName("reason")
          .setDescription("Why do you want to tryout? (optional)")
          .setRequired(false)
      )
      .toJSON(),

    // /giveaway
    new SlashCommandBuilder()
      .setName("giveaway")
      .setDescription("Giveaway management commands")
      .addSubcommand((sub) =>
        sub.setName("host").setDescription("Host a giveaway")
          .addStringOption((opt) =>
            opt.setName("prize").setDescription("What is being given away?").setRequired(true)
          )
          .addIntegerOption((opt) =>
            opt.setName("duration")
              .setDescription("Duration in minutes")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(10080)
          )
          .addIntegerOption((opt) =>
            opt.setName("winners")
              .setDescription("Number of winners")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(20)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("end").setDescription("End a giveaway early")
          .addStringOption((opt) =>
            opt.setName("id").setDescription("Giveaway ID").setRequired(true)
          )
      )
      .toJSON(),

    // /tournament
    new SlashCommandBuilder()
      .setName("tournament")
      .setDescription("Host a tournament")
      .addSubcommand((sub) =>
        sub.setName("host").setDescription("Host a new tournament")
          .addIntegerOption((opt) =>
            opt.setName("ft")
              .setDescription("First to X wins")
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(20)
          )
          .addStringOption((opt) =>
            opt.setName("prize").setDescription("Tournament prize").setRequired(true)
          )
          .addStringOption((opt) =>
            opt.setName("type").setDescription("Match type").setRequired(true)
              .addChoices(
                { name: "1v1", value: "1v1" },
                { name: "2v2", value: "2v2" },
                { name: "3v3", value: "3v3" },
                { name: "4v4", value: "4v4" }
              )
          )
          .addStringOption((opt) =>
            opt.setName("banned_map")
              .setDescription("Banned map (optional)")
              .setRequired(false)
          )
          .addStringOption((opt) =>
            opt.setName("server_link")
              .setDescription("Server invite link (optional)")
              .setRequired(false)
          )
      )
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Command registration failed:", err);
  }
}

// ─── Client Setup ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── Ready ────────────────────────────────────────────────────────────────────
client.once("clientReady", async () => {
  console.log(`Bot online: ${client.user.tag}`);
  await registerCommands();

  // Re-schedule any active giveaways that survived a restart
  const db = loadDB();
  for (const giveaway of Object.values(db.giveaways)) {
    if (giveaway.active) {
      scheduleGiveaway(giveaway, client);
      console.log(`Re-scheduled giveaway: ${giveaway.id}`);
    }
  }
});

// ─── Spam Detection ───────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const now = Date.now();

  if (!spamMap.has(userId)) {
    spamMap.set(userId, { timestamps: [], contents: [], warnedAt: 0 });
  }

  const tracker = spamMap.get(userId);

  // Rolling window — drop timestamps outside the window
  tracker.timestamps = tracker.timestamps.filter((t) => now - t < SPAM_WINDOW);
  tracker.timestamps.push(now);

  // Track last 5 messages for duplicate detection
  const content = message.content || "";
  tracker.contents.push(content);
  if (tracker.contents.length > 5) tracker.contents.shift();

  const isRateLimited = tracker.timestamps.length >= SPAM_LIMIT;
  const isDuplicate = content.length > 1 &&
    tracker.contents.filter((c) => c === content).length >= 3;

  if (isRateLimited || isDuplicate) {
    const canDelete = message.channel
      .permissionsFor(message.guild.members.me)
      ?.has(PermissionFlagsBits.ManageMessages);

    if (canDelete) {
      try { await message.delete(); } catch (_) {}
    }

    if (now - tracker.warnedAt > WARN_COOLDOWN) {
      tracker.warnedAt = now;
      const warn = await message.channel.send(
        `<@${userId}>, please slow down. Spam is not permitted in this server.`
      );
      setTimeout(() => warn.delete().catch(() => {}), 6000);
    }
  }
});

// ─── Interactions ─────────────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {

  // ── /league ─────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === "league") {
    const sub = interaction.options.getSubcommand();

    if (sub === "host") {
      if (interaction.channelId !== LEAGUE_CHANNEL_ID) {
        return interaction.reply({
          content: `Leagues can only be hosted in <#${LEAGUE_CHANNEL_ID}>.`,
          ephemeral: true,
        });
      }
      if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE_ID)) {
        return interaction.reply({
          content: "You do not have permission to host leagues.",
          ephemeral: true,
        });
      }

      const format = interaction.options.getString("format");
      const matchType = interaction.options.getString("match_type");
      const perks = interaction.options.getString("perks");
      const region = interaction.options.getString("region");
      const maxPlayers = getMaxPlayers(format);

      const db = loadDB();
      const leagueId = uniqueId(db.leagues);

      await interaction.deferReply();

      let thread = null;
      try {
        thread = await interaction.channel.threads.create({
          name: `League ${leagueId}`,
          type: ChannelType.PrivateThread,
          autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
          invitable: false,
        });
        await thread.members.add(interaction.user.id);
      } catch (err) {
        console.error("Thread creation error:", err.message);
      }

      const league = {
        id: leagueId, format, matchType, perks, region,
        hostId: interaction.user.id, maxPlayers,
        players: [interaction.user.id],
        threadId: thread?.id ?? null,
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        messageId: null, active: true,
        createdAt: new Date().toISOString(),
      };

      db.leagues[leagueId] = league;
      saveDB(db);

      await interaction.channel.send(`<@&${LEAGUES_PING_ROLE_ID}>`);
      const msg = await interaction.editReply({
        embeds: [buildLeagueEmbed(league)],
        components: [buildJoinRow(leagueId)],
      });

      db.leagues[leagueId].messageId = msg.id;
      saveDB(db);

      if (thread) {
        await thread.send(
          `League **${leagueId}** has been opened.\n\n**Format:** ${format}  |  **Match Type:** ${matchType}  |  **Perks:** ${perks}  |  **Region:** ${region}\n\nThis is your private league thread. Players will be added here as they join.`
        );
      }
      return;
    }

    if (sub === "cancel") {
      if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE_ID)) {
        return interaction.reply({
          content: "You do not have permission to cancel leagues.",
          ephemeral: true,
        });
      }

      const id = interaction.options.getString("id").trim().toUpperCase();
      const db = loadDB();
      const league = db.leagues[id];

      if (!league || !league.active) {
        return interaction.reply({
          content: `No active league found with ID \`${id}\`.`,
          ephemeral: true,
        });
      }

      if (league.threadId) {
        try {
          const thread = await interaction.guild.channels.fetch(league.threadId);
          if (thread) {
            await thread.send(`League **${id}** has been cancelled. This thread will now be archived.`);
            await thread.setArchived(true);
          }
        } catch (err) { console.error("Thread archive error:", err.message); }
      }

      if (league.messageId) {
        try {
          const channel = await interaction.guild.channels.fetch(league.channelId);
          const msg = await channel.messages.fetch(league.messageId);
          if (msg) {
            await msg.edit({
              embeds: [buildLeagueEmbed(league).setTitle("League Cancelled").setColor(0xed4245)],
              components: [buildJoinRow(id, true)],
            });
          }
        } catch (err) { console.error("Message edit error:", err.message); }
      }

      db.leagues[id].active = false;
      saveDB(db);
      return interaction.reply({
        content: `League \`${id}\` has been cancelled.`,
        ephemeral: true,
      });
    }
  }

  // ── /tryout ──────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === "tryout") {
    const username = interaction.options.getString("username");
    const platform = interaction.options.getString("platform");
    const reason = interaction.options.getString("reason") || "Not provided.";

    await interaction.deferReply({ ephemeral: true });

    const db = loadDB();
    const tryoutId = uniqueId(db.tryouts);

    let thread = null;
    try {
      thread = await interaction.channel.threads.create({
        name: `Tryout — ${username}`,
        type: ChannelType.PrivateThread,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        invitable: false,
      });
      await thread.members.add(interaction.user.id);
    } catch (err) {
      console.error("Tryout thread error:", err.message);
      return interaction.editReply({
        content: "Failed to create the tryout ticket. Please ensure the bot has the Manage Threads permission.",
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("Tryout Ticket")
      .setColor(0x57f287)
      .addFields(
        { name: "Applicant", value: `<@${interaction.user.id}>`, inline: true },
        { name: "In-Game Username", value: username, inline: true },
        { name: "Platform", value: platform, inline: true },
        { name: "Reason", value: reason, inline: false },
        { name: "Ticket ID", value: `\`${tryoutId}\``, inline: false }
      )
      .setFooter({ text: "Tryout managers have been notified." })
      .setTimestamp();

    await thread.send({
      content: `<@&${TRYOUT_MANAGER_ROLE_ID}> — A new tryout ticket has been submitted.`,
      embeds: [embed],
    });

    db.tryouts[tryoutId] = {
      id: tryoutId,
      userId: interaction.user.id,
      username, platform, reason,
      threadId: thread.id,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      createdAt: new Date().toISOString(),
    };
    saveDB(db);

    return interaction.editReply({
      content: "Your tryout ticket has been created. Check the private thread that just opened.",
    });
  }

  // ── /giveaway ────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === "giveaway") {
    const sub = interaction.options.getSubcommand();

    if (sub === "host") {
      const prize = interaction.options.getString("prize");
      const duration = interaction.options.getInteger("duration");
      const winners = interaction.options.getInteger("winners");
      const endsAt = new Date(Date.now() + duration * 60 * 1000).toISOString();

      const db = loadDB();
      const giveawayId = uniqueId(db.giveaways);

      const giveaway = {
        id: giveawayId, prize, winners,
        hostId: interaction.user.id, endsAt,
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        messageId: null, active: true,
        createdAt: new Date().toISOString(),
      };

      const msg = await interaction.reply({
        embeds: [buildGiveawayEmbed(giveaway)],
        fetchReply: true,
      });
      await msg.react("🎉");

      giveaway.messageId = msg.id;
      db.giveaways[giveawayId] = giveaway;
      saveDB(db);

      scheduleGiveaway(giveaway, client);
      return;
    }

    if (sub === "end") {
      const id = interaction.options.getString("id").trim().toUpperCase();
      const db = loadDB();
      const giveaway = db.giveaways[id];

      if (!giveaway || !giveaway.active) {
        return interaction.reply({
          content: `No active giveaway found with ID \`${id}\`.`,
          ephemeral: true,
        });
      }

      if (giveawayTimers.has(id)) {
        clearTimeout(giveawayTimers.get(id));
        giveawayTimers.delete(id);
      }

      await interaction.reply({ content: `Ending giveaway \`${id}\`...`, ephemeral: true });
      await endGiveaway(id, client);
      return;
    }
  }

  // ── /tournament ──────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === "tournament") {
    const sub = interaction.options.getSubcommand();

    if (sub === "host") {
      const ft = interaction.options.getInteger("ft");
      const prize = interaction.options.getString("prize");
      const type = interaction.options.getString("type");
      const bannedMap = interaction.options.getString("banned_map") || null;
      const serverLink = interaction.options.getString("server_link") || null;

      const db = loadDB();
      const tourneyId = uniqueId(db.tournaments);

      const tournament = {
        id: tourneyId, ft, prize, type, bannedMap, serverLink,
        hostId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        createdAt: new Date().toISOString(),
      };

      db.tournaments[tourneyId] = tournament;
      saveDB(db);

      const embed = buildTournamentEmbed(tournament);
      const row = buildTournamentRow(tournament);
      const replyOptions = { embeds: [embed] };
      if (row) replyOptions.components = [row];

      return interaction.reply(replyOptions);
    }
  }

  // ── Join League Button ────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const { customId } = interaction;
    if (!customId.startsWith("join_league_")) return;

    const leagueId = customId.replace("join_league_", "");
    const db = loadDB();
    const league = db.leagues[leagueId];

    if (!league || !league.active) {
      return interaction.reply({ content: "This league is no longer active.", ephemeral: true });
    }
    if (league.players.includes(interaction.user.id)) {
      return interaction.reply({ content: "You have already joined this league.", ephemeral: true });
    }
    if (league.players.length >= league.maxPlayers) {
      return interaction.reply({ content: "This league is full.", ephemeral: true });
    }

    db.leagues[leagueId].players.push(interaction.user.id);
    const updated = db.leagues[leagueId];
    saveDB(db);

    if (updated.threadId) {
      try {
        const thread = await interaction.guild.channels.fetch(updated.threadId);
        if (thread) {
          await thread.members.add(interaction.user.id);
          await thread.send(
            `<@${interaction.user.id}> has joined the league. (${updated.players.length} / ${updated.maxPlayers} players)`
          );
        }
      } catch (err) { console.error("Thread join error:", err.message); }
    }

    const isFull = updated.players.length >= updated.maxPlayers;
    await interaction.update({
      embeds: [buildLeagueEmbed(updated)],
      components: [buildJoinRow(leagueId, isFull)],
    });

    if (isFull) {
      db.leagues[leagueId].active = false;
      saveDB(db);

      if (updated.threadId) {
        try {
          const thread = await interaction.guild.channels.fetch(updated.threadId);
          if (thread) {
            const allMentions = updated.players.map((p) => `<@${p}>`).join(" ");
            await thread.send(
              `${allMentions}\n\nThe league is now full. All players are confirmed.\n\n**Format:** ${updated.format}  |  **Match Type:** ${updated.matchType}  |  **Perks:** ${updated.perks}  |  **Region:** ${updated.region}\n\nGood luck.`
            );
          }
        } catch (err) { console.error("Thread full message error:", err.message); }
      }
    }
  }
});

// ─── Startup Checks ───────────────────────────────────────────────────────────
if (!TOKEN) { console.error("Missing DISCORD_TOKEN."); process.exit(1); }
if (!CLIENT_ID) { console.error("Missing CLIENT_ID."); process.exit(1); }

client.login(TOKEN).catch((err) => {
  console.error("Login failed:", err.message);
  process.exit(1);
});
