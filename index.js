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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const fs = require("fs");

// ─── Crash guard — prevent the process from dying on unhandled rejections ─────
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

// ─── Config ────────────────────────────────────────────────────────────[...]
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const LEAGUE_CHANNEL_ID      = "1462387975022186621";
const LEAGUE_HOST_ROLE_ID    = "1500064722312233050";
const LEAGUES_PING_ROLE_ID   = "1500068561174003853";

const TRYOUT_MANAGER_ROLE_ID = "1504836079650476065";
const TRYOUT_CHANNEL_ID      = "1491183434561749123";

const TOURNAMENT_HOST_ROLE_ID = "1503089031649431582";
const TOURNAMENT_CHANNEL_ID   = "1462389214313451561";
const TOURNAMENT_SIGNUPS_CHANNEL_ID = "1462389355568959529";

const GIVEAWAY_HOST_ROLE_ID   = "1503089031649431582";

const DB_PATH = "./database.json";

// ─── Spam Config ──────────────────────────────────────────────────────────[...]
const SPAM_LIMIT    = 5;
const SPAM_WINDOW   = 5000;
const WARN_COOLDOWN = 15000;
const spamMap       = new Map();

// ─── Database ───────────────────────────────────────────────────────────[...]
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const def = { leagues: {}, giveaways: {}, tournaments: {}, tryouts: {}, ticketCounter: 0 };
    fs.writeFileSync(DB_PATH, JSON.stringify(def, null, 2));
    return def;
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (!data.giveaways)  data.giveaways  = {};
  if (!data.tournaments) data.tournaments = {};
  if (!data.tryouts)    data.tryouts    = {};
  if (typeof data.ticketCounter !== "number") data.ticketCounter = 0;
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

function padTicketNumber(n) {
  return String(n).padStart(4, "0");
}

// Role check — uses the member object Discord sends with every interaction (instant, no API call)
function hasRole(interaction, roleId) {
  return interaction.member.roles.cache.has(roleId);
}

// ─── League ────────────────────────────────────────────────────────────[...]
function getMaxPlayers(format) {
  return parseInt(format.charAt(0)) * 2;
}

function buildLeagueEmbed(league) {
  const spotsLeft  = league.maxPlayers - league.players.length;
  const playerList = league.players.length > 0
    ? league.players.map((p) => `<@${p}>`).join("\n")
    : "None";
  return new EmbedBuilder()
    .setTitle("League Available")
    .setColor(0x5865f2)
    .addFields(
      { name: "Format",     value: league.format,               inline: true },
      { name: "Match Type", value: league.matchType,            inline: true },
      { name: "Perks",      value: league.perks,                inline: true },
      { name: "Region",     value: league.region,               inline: true },
      { name: "Host",       value: `<@${league.hostId}>`,       inline: true },
      { name: "Spots Left", value: `${spotsLeft} / ${league.maxPlayers}`, inline: true },
      { name: "Players",    value: playerList,                  inline: false },
      { name: "League ID",  value: `\`${league.id}\``,          inline: false }
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

// ─── Giveaway ───────────────────────────────────────────────────────────[...]
const giveawayTimers = new Map();

function buildGiveawayEmbed(giveaway) {
  const unixEnd = Math.floor(new Date(giveaway.endsAt).getTime() / 1000);
  return new EmbedBuilder()
    .setTitle("Giveaway")
    .setColor(0xfaa61a)
    .addFields(
      { name: "Prize",     value: giveaway.prize,          inline: false },
      { name: "Winners",   value: `${giveaway.winners}`,   inline: true  },
      { name: "Ends",      value: `<t:${unixEnd}:R>`,      inline: true  },
      { name: "Hosted By", value: `<@${giveaway.hostId}>`, inline: true  }
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
    const channel  = await client.channels.fetch(giveaway.channelId);
    const msg      = await channel.messages.fetch(giveaway.messageId);
    const reaction = msg.reactions.cache.get("🎉");
    let entries = [];
    if (reaction) {
      const users = await reaction.users.fetch();
      entries = users.filter((u) => !u.bot).map((u) => u.id);
    }
    const winnerCount = Math.min(giveaway.winners, entries.length);
    const winners     = [...entries].sort(() => Math.random() - 0.5).slice(0, winnerCount);
    const endEmbed = new EmbedBuilder()
      .setTitle("Giveaway Ended")
      .setColor(0xed4245)
      .addFields(
        { name: "Prize",   value: giveaway.prize, inline: false },
        { name: "Winners", value: winners.length > 0 ? winners.map((w) => `<@${w}>`).join(", ") : "No valid entries.", inline: false },
        { name: "Total Entries", value: `${entries.length}`, inline: true },
        { name: "Hosted By",     value: `<@${giveaway.hostId}>`, inline: true }
      )
      .setTimestamp();
    await msg.edit({ embeds: [endEmbed] });
    if (winners.length > 0) {
      await channel.send(`Congratulations ${winners.map((w) => `<@${w}>`).join(", ")}! You have won the **${giveaway.prize}** giveaway.`);
    } else {
      await channel.send(`The giveaway for **${giveaway.prize}** has ended. No valid entries were found.`);
    }
  } catch (err) {
    console.error("Giveaway end error:", err.message);
  }
}

function scheduleGiveaway(giveaway, client) {
  const delay = Math.max(new Date(giveaway.endsAt).getTime() - Date.now(), 0);
  const timer  = setTimeout(() => endGiveaway(giveaway.id, client), delay);
  giveawayTimers.set(giveaway.id, timer);
}

// ─── Tournament ──────────────────────────────────────────────────────────[...]
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
    { name: "Type",      value: tournament.type,              inline: true },
    { name: "FT",        value: `First to ${tournament.ft}`, inline: true },
    { name: "Prize",     value: tournament.prize,             inline: true },
    { name: "Hosted By", value: `<@${tournament.hostId}>`,   inline: true },
  ];
  if (tournament.bannedMap) fields.push({ name: "Banned Map", value: tournament.bannedMap, inline: true });
  fields.push({ name: "\u200b", value: "\u200b", inline: false });
  fields.push({ name: "Rules",  value: TOURNAMENT_RULES,     inline: false });
  return new EmbedBuilder()
    .setTitle("Tournament")
    .setColor(0xe67e22)
    .addFields(...fields)
    .setFooter({ text: `Tournament ID: ${tournament.id}` })
    .setTimestamp();
}

function buildTournamentRow(tournament) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament_signup_${tournament.id}`)
      .setLabel("Sign Up")
      .setStyle(ButtonStyle.Primary)
  );
  if (tournament.serverLink) {
    row.addComponents(
      new ButtonBuilder().setLabel("Join Server").setStyle(ButtonStyle.Link).setURL(tournament.serverLink)
    );
  }
  return row;
}

// ─── Tryout Panel ────────────────────────────────────────────────────────[...]
function buildTryoutPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("TRYOUT REQUEST")
    .setDescription("To receive a tryout, open a ticket by clicking the button down below!")
    .setColor(0x57f287);
}

function buildTryoutPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_tryout_ticket")
      .setLabel("Create ticket")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildCloseRow(ticketId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`close_ticket_${ticketId}`)
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
  );
}

// ─── Tryout Form Modal ───────────────────────────────────────────────────
function buildTryoutFormModal() {
  return new ModalBuilder()
    .setCustomId("tryout_form_modal")
    .setTitle("Tryout Request Form")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("tryout_roblox_username")
          .setLabel("Roblox username")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("enter your username")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("tryout_platform")
          .setLabel("Platform")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("PC/MOB/XBOX")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("tryout_server_link")
          .setLabel("Paste your private server link")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("paste here")
          .setRequired(true)
      )
    );
}

// ─── Tournament Signup Form Modal ────────────────────────────────────────
function buildTournamentSignupModal(tournamentId) {
  return new ModalBuilder()
    .setCustomId(`tournament_signup_form_${tournamentId}`)
    .setTitle("Tournament Sign Up")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("tournament_roblox_username")
          .setLabel("Roblox username")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("enter your username")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("tournament_rank")
          .setLabel("Rank")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. Diamond, Gold")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("tournament_discord_username")
          .setLabel("Discord username")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("your discord username")
          .setRequired(true)
      )
    );
}

// Tournament host approval buttons
function buildTournamentApprovalRow(tournamentId, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament_accept_${tournamentId}_${userId}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`tournament_decline_${tournamentId}_${userId}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger)
  );
}

// Update tournament signups counter
async function updateTournamentSignupCounter(client, tournamentId) {
  const db = loadDB();
  const tournament = db.tournaments[tournamentId];
  if (!tournament) return;

  const signupCount = (tournament.signups || []).length;
  const maxPlayers = getMaxPlayers(tournament.type);
  
  try {
    const channel = await client.channels.fetch(TOURNAMENT_SIGNUPS_CHANNEL_ID);
    let message = null;
    
    if (tournament.signupMessageId) {
      try {
        message = await channel.messages.fetch(tournament.signupMessageId);
      } catch (err) {
        console.log("Signup message not found, creating new one");
      }
    }

    const signupEmbed = new EmbedBuilder()
      .setTitle(`Tournament ${tournamentId} Sign Ups`)
      .setColor(0xe67e22)
      .addFields(
        { name: "Players Joined", value: `${signupCount}/${maxPlayers}`, inline: false }
      )
      .setTimestamp();

    if (message) {
      await message.edit({ embeds: [signupEmbed] });
    } else {
      const newMsg = await channel.send({ embeds: [signupEmbed] });
      db.tournaments[tournamentId].signupMessageId = newMsg.id;
      saveDB(db);
    }
  } catch (err) {
    console.error("Failed to update tournament signup counter:", err.message);
  }
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
              .addChoices({ name: "2v2", value: "2v2" }, { name: "3v3", value: "3v3" }, { name: "4v4", value: "4v4" })
          )
          .addStringOption((opt) =>
            opt.setName("match_type").setDescription("Match type").setRequired(true)
              .addChoices({ name: "Swift Game", value: "Swift Game" }, { name: "War Game", value: "War Game" })
          )
          .addStringOption((opt) =>
            opt.setName("perks").setDescription("Match perks").setRequired(true)
              .addChoices({ name: "Perks", value: "Perks" }, { name: "No Perks", value: "No Perks" })
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
          .addStringOption((opt) => opt.setName("id").setDescription("League ID").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName("add").setDescription("Add a player to an active league")
          .addStringOption((opt) => opt.setName("id").setDescription("League ID").setRequired(true))
          .addUserOption((opt) => opt.setName("player").setDescription("Player to add").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName("remove").setDescription("Remove a player from an active league")
          .addStringOption((opt) => opt.setName("id").setDescription("League ID").setRequired(true))
          .addUserOption((opt) => opt.setName("player").setDescription("Player to remove").setRequired(true))
      )
      .toJSON(),

    // /giveaway
    new SlashCommandBuilder()
      .setName("giveaway")
      .setDescription("Giveaway management commands")
      .addSubcommand((sub) =>
        sub.setName("host").setDescription("Host a giveaway")
          .addStringOption((opt) => opt.setName("prize").setDescription("What is being given away?").setRequired(true))
          .addIntegerOption((opt) =>
            opt.setName("duration").setDescription("Duration in minutes").setRequired(true).setMinValue(1).setMaxValue(10080)
          )
          .addIntegerOption((opt) =>
            opt.setName("winners").setDescription("Number of winners").setRequired(true).setMinValue(1).setMaxValue(20)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("end").setDescription("End a giveaway early")
          .addStringOption((opt) => opt.setName("id").setDescription("Giveaway ID").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName("reroll").setDescription("Reroll a new winner for an ended giveaway")
          .addStringOption((opt) => opt.setName("id").setDescription("Giveaway ID").setRequired(true))
          .addIntegerOption((opt) =>
            opt.setName("winners").setDescription("How many winners to reroll (default: 1)").setRequired(false).setMinValue(1).setMaxValue(20)
          )
      )
      .toJSON(),

    // /tournament
    new SlashCommandBuilder()
      .setName("tournament")
      .setDescription("Tournament management commands")
      .addSubcommand((sub) =>
        sub.setName("host").setDescription("Host a new tournament")
          .addIntegerOption((opt) =>
            opt.setName("ft").setDescription("First to X wins").setRequired(true).setMinValue(1).setMaxValue(20)
          )
          .addStringOption((opt) => opt.setName("prize").setDescription("Tournament prize").setRequired(true))
          .addStringOption((opt) =>
            opt.setName("type").setDescription("Match type").setRequired(true)
              .addChoices({ name: "1v1", value: "1v1" }, { name: "2v2", value: "2v2" }, { name: "3v3", value: "3v3" }, { name: "4v4", value: "4v4" })
          )
          .addStringOption((opt) => opt.setName("banned_map").setDescription("Banned map (optional)").setRequired(false))
          .addStringOption((opt) => opt.setName("server_link").setDescription("Server invite link (optional)").setRequired(false))
      )
      .addSubcommand((sub) =>
        sub.setName("cancel").setDescription("Cancel a tournament by ID")
          .addStringOption((opt) => opt.setName("id").setDescription("Tournament ID").setRequired(true))
      )
      .toJSON(),

    // /ticket
    new SlashCommandBuilder()
      .setName("ticket")
      .setDescription("Ticket management")
      .addSubcommand((sub) => sub.setName("close").setDescription("Close the current ticket channel"))
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

// ─── Client ──────────────────────────────────────────────────────────[...]
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.on("error", (err) => console.error("Client error:", err.message));

client.once("ready", async () => {
  console.log(`Bot online: ${client.user.tag}`);
  await registerCommands();
  const db = loadDB();

  for (const giveaway of Object.values(db.giveaways)) {
    if (giveaway.active) {
      scheduleGiveaway(giveaway, client);
      console.log(`Re-scheduled giveaway: ${giveaway.id}`);
    }
  }

  if (!db.tryoutPanelMessageId) {
    try {
      const tryoutChannel = await client.channels.fetch(TRYOUT_CHANNEL_ID);
      const panelMsg = await tryoutChannel.send({
        embeds: [buildTryoutPanelEmbed()],
        components: [buildTryoutPanelRow()],
      });
      db.tryoutPanelMessageId = panelMsg.id;
      saveDB(db);
      console.log(`Tryout panel posted (message ${panelMsg.id}).`);
    } catch (err) {
      console.error("Failed to post tryout panel:", err.message);
    }
  } else {
    console.log(`Tryout panel already posted (message ${db.tryoutPanelMessageId}). Skipping.`);
  }
});

// ─── Spam Detection ─────────────────────────────────────────────────────────[...]
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  const userId = message.author.id;
  const now    = Date.now();
  if (!spamMap.has(userId)) spamMap.set(userId, { timestamps: [], contents: [], warnedAt: 0 });
  const tracker = spamMap.get(userId);
  tracker.timestamps = tracker.timestamps.filter((t) => now - t < SPAM_WINDOW);
  tracker.timestamps.push(now);
  const content = message.content || "";
  tracker.contents.push(content);
  if (tracker.contents.length > 5) tracker.contents.shift();
  const isRateLimited = tracker.timestamps.length >= SPAM_LIMIT;
  const isDuplicate   = content.length > 1 && tracker.contents.filter((c) => c === content).length >= 3;
  if (isRateLimited || isDuplicate) {
    const canDelete = message.channel.permissionsFor(message.guild.members.me)?.has(PermissionFlagsBits.ManageMessages);
    if (canDelete) { try { await message.delete(); } catch (_) {} }
    if (now - tracker.warnedAt > WARN_COOLDOWN) {
      tracker.warnedAt = now;
      const warn = await message.channel.send(`<@${userId}>, please slow down. Spam is not permitted in this server.`);
      setTimeout(() => warn.delete().catch(() => {}), 6000);
    }
  }
});

// ─── Interactions ──────────────────────────────────────────────────────────[...]
client.on("interactionCreate", async (interaction) => {
  try {

    // ── /league ───────────────────────────────────────────────────────────[...]
    if (interaction.isChatInputCommand() && interaction.commandName === "league") {
      const sub = interaction.options.getSubcommand();

      // ── league host ─────────────────────────────────────────────────────────[...]
      if (sub === "host") {
        if (interaction.channelId !== LEAGUE_CHANNEL_ID) {
          return interaction.reply({ content: `Leagues can only be hosted in <#${LEAGUE_CHANNEL_ID}>.`, ephemeral: true });
        }
        if (!hasRole(interaction, LEAGUE_HOST_ROLE_ID)) {
          return interaction.reply({ content: "You do not have permission to host leagues.", ephemeral: true });
        }

        const format     = interaction.options.getString("format");
        const matchType  = interaction.options.getString("match_type");
        const perks      = interaction.options.getString("perks");
        const region     = interaction.options.getString("region");
        const maxPlayers = getMaxPlayers(format);
        const db         = loadDB();
        const leagueId   = uniqueId(db.leagues);

        await interaction.deferReply();

        // Private thread — only players who joined can see it
        let thread = null;
        try {
          thread = await interaction.channel.threads.create({
            name: `League ${leagueId}`,
            type: ChannelType.PrivateThread,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
          });
        } catch (err) { console.error("Thread creation error:", err.message); }

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
        const msg = await interaction.editReply({ embeds: [buildLeagueEmbed(league)], components: [buildJoinRow(leagueId)] });
        db.leagues[leagueId].messageId = msg.id;
        saveDB(db);

        if (thread) {
          await thread.send(
            `League **${leagueId}** has been opened.\n\n**Format:** ${format}  |  **Match Type:** ${matchType}  |  **Perks:** ${perks}  |  **Region:** ${region}\n\nPlayers will appear here as they join.`
          );
        }
        return;
      }

      // ── league cancel ────────────────────────────────────────────────────────
      if (sub === "cancel") {
        if (!hasRole(interaction, LEAGUE_HOST_ROLE_ID)) {
          return interaction.reply({ content: "You do not have permission to cancel leagues.", ephemeral: true });
        }
        const id  = interaction.options.getString("id").trim().toUpperCase();
        const db  = loadDB();
        const league = db.leagues[id];
        if (!league || !league.active) {
          return interaction.reply({ content: `No active league found with ID \`${id}\`.`, ephemeral: true });
        }
        if (league.threadId) {
          try {
            const thread = await interaction.guild.channels.fetch(league.threadId);
            if (thread) {
              await thread.send(`League **${id}** has been cancelled. Deleting thread in 3 seconds...`);
              setTimeout(() => thread.delete("League cancelled.").catch(() => {}), 3000);
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
        return interaction.reply({ content: `League \`${id}\` has been cancelled.`, ephemeral: true });
      }

      // ── league add ─────────────────────────────────────────────────────────[...]
      if (sub === "add") {
        if (!hasRole(interaction, LEAGUE_HOST_ROLE_ID)) {
          return interaction.reply({ content: "You do not have permission to manage leagues.", ephemeral: true });
        }
        const id     = interaction.options.getString("id").trim().toUpperCase();
        const target = interaction.options.getUser("player");
        const db     = loadDB();
        const league = db.leagues[id];
        if (!league || !league.active) {
          return interaction.reply({ content: `No active league found with ID \`${id}\`.`, ephemeral: true });
        }
        if (league.players.includes(target.id)) {
          return interaction.reply({ content: `<@${target.id}> is already in this league.`, ephemeral: true });
        }
        if (league.players.length >= league.maxPlayers) {
          return interaction.reply({ content: `League \`${id}\` is already full.`, ephemeral: true });
        }

        db.leagues[id].players.push(target.id);
        const updated = db.leagues[id];
        const isFull  = updated.players.length >= updated.maxPlayers;
        if (isFull) db.leagues[id].active = false;
        saveDB(db);

        if (updated.threadId) {
          try {
            const thread = await interaction.guild.channels.fetch(updated.threadId);
            if (thread) {
              await thread.members.add(target.id);
              await thread.send(`<@${target.id}> has been added to the league by <@${interaction.user.id}>. (${updated.players.length} / ${updated.maxPlayers})`);
            }
          } catch (err) { console.error("Thread add error:", err.message); }
        }

        if (league.messageId) {
          try {
            const channel = await interaction.guild.channels.fetch(league.channelId);
            const msg = await channel.messages.fetch(league.messageId);
            if (msg) await msg.edit({ embeds: [buildLeagueEmbed(updated)], components: [buildJoinRow(id, isFull)] });
          } catch (err) { console.error("League add message edit error:", err.message); }
        }

        return interaction.reply({ content: `<@${target.id}> has been added to league \`${id}\`.`, ephemeral: true });
      }

      // ── league remove ────────────────────────────────────────────────────────
      if (sub === "remove") {
        if (!hasRole(interaction, LEAGUE_HOST_ROLE_ID)) {
          return interaction.reply({ content: "You do not have permission to manage leagues.", ephemeral: true });
        }
        const id     = interaction.options.getString("id").trim().toUpperCase();
        const target = interaction.options.getUser("player");
        const db     = loadDB();
        const league = db.leagues[id];
        if (!league) {
          return interaction.reply({ content: `No league found with ID \`${id}\`.`, ephemeral: true });
        }
        if (!league.players.includes(target.id)) {
          return interaction.reply({ content: `<@${target.id}> is not in this league.`, ephemeral: true });
        }

        db.leagues[id].players = league.players.filter((p) => p !== target.id);
        // Reopen if it was full
        if (!db.leagues[id].active) db.leagues[id].active = true;
        const updated = db.leagues[id];
        saveDB(db);

        if (updated.threadId) {
          try {
            const thread = await interaction.guild.channels.fetch(updated.threadId);
            if (thread) {
              await thread.members.remove(target.id);
              await thread.send(`<@${target.id}> has been removed from the league by <@${interaction.user.id}>. (${updated.players.length} / ${updated.maxPlayers})`);
            }
          } catch (err) { console.error("Thread remove error:", err.message); }
        }

        if (league.messageId) {
          try {
            const channel = await interaction.guild.channels.fetch(league.channelId);
            const msg = await channel.messages.fetch(league.messageId);
            if (msg) await msg.edit({ embeds: [buildLeagueEmbed(updated)], components: [buildJoinRow(id, false)] });
          } catch (err) { console.error("League remove message edit error:", err.message); }
        }

        return interaction.reply({ content: `<@${target.id}> has been removed from league \`${id}\`. Their spot is now open.`, ephemeral: true });
      }
    }

    // ── /giveaway ──────────────────────────────────────────────────────────[...]
    if (interaction.isChatInputCommand() && interaction.commandName === "giveaway") {
      const sub = interaction.options.getSubcommand();
      if (!hasRole(interaction, GIVEAWAY_HOST_ROLE_ID)) {
        return interaction.reply({ content: "You do not have permission to manage giveaways.", ephemeral: true });
      }

      if (sub === "host") {
        const prize    = interaction.options.getString("prize");
        const duration = interaction.options.getInteger("duration");
        const winners  = interaction.options.getInteger("winners");
        const endsAt   = new Date(Date.now() + duration * 60 * 1000).toISOString();
        const db       = loadDB();
        const giveawayId = uniqueId(db.giveaways);
        const giveaway = {
          id: giveawayId, prize, winners,
          hostId: interaction.user.id, endsAt,
          channelId: interaction.channelId,
          guildId: interaction.guildId,
          messageId: null, active: true,
          createdAt: new Date().toISOString(),
        };
        const msg = await interaction.reply({ embeds: [buildGiveawayEmbed(giveaway)], fetchReply: true });
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
          return interaction.reply({ content: `No active giveaway found with ID \`${id}\`.`, ephemeral: true });
        }
        if (giveawayTimers.has(id)) {
          clearTimeout(giveawayTimers.get(id));
          giveawayTimers.delete(id);
        }
        await interaction.reply({ content: `Ending giveaway \`${id}\`...`, ephemeral: true });
        await endGiveaway(id, client);
        return;
      }

      if (sub === "reroll") {
        const id          = interaction.options.getString("id").trim().toUpperCase();
        const winnerCount = interaction.options.getInteger("winners") ?? 1;
        const db          = loadDB();
        const giveaway    = db.giveaways[id];
        if (!giveaway) {
          return interaction.reply({ content: `No giveaway found with ID \`${id}\`.`, ephemeral: true });
        }
        if (giveaway.active) {
          return interaction.reply({ content: `Giveaway \`${id}\` is still active. End it first.`, ephemeral: true });
        }
        await interaction.deferReply();
        try {
          const channel  = await client.channels.fetch(giveaway.channelId);
          const msg      = await channel.messages.fetch(giveaway.messageId);
          const reaction = msg.reactions.cache.get("🎉");
          let entries = [];
          if (reaction) {
            const users = await reaction.users.fetch();
            entries = users.filter((u) => !u.bot).map((u) => u.id);
          }
          if (entries.length === 0) {
            return interaction.editReply({ content: `No valid entries found for giveaway \`${id}\`. Cannot reroll.` });
          }
          const picked = [...entries].sort(() => Math.random() - 0.5).slice(0, Math.min(winnerCount, entries.length));
          const rerollEmbed = new EmbedBuilder()
            .setTitle("Giveaway Reroll")
            .setColor(0x5865f2)
            .addFields(
              { name: "Prize",       value: giveaway.prize, inline: false },
              { name: "New Winner(s)", value: picked.map((w) => `<@${w}>`).join(", "), inline: false },
              { name: "Rerolled By", value: `<@${interaction.user.id}>`, inline: true }
            )
            .setFooter({ text: `Giveaway ID: ${id}` })
            .setTimestamp();
          await interaction.editReply({ embeds: [rerollEmbed] });
          await channel.send(
            `Congratulations ${picked.map((w) => `<@${w}>`).join(", ")}! You have been rerolled as the new winner of the **${giveaway.prize}** giveaway!`
          );
        } catch (err) {
          console.error("Giveaway reroll error:", err.message);
          return interaction.editReply({ content: "Failed to reroll. The original giveaway message may have been deleted." });
        }
        return;
      }
    }

    // ── /tournament ────────────────────────────────────────────────────────[...]
    if (interaction.isChatInputCommand() && interaction.commandName === "tournament") {
      const sub = interaction.options.getSubcommand();

      if (sub === "host") {
        if (interaction.channelId !== TOURNAMENT_CHANNEL_ID) {
          return interaction.reply({ content: `Tournaments can only be hosted in <#${TOURNAMENT_CHANNEL_ID}>.`, ephemeral: true });
        }
        if (!hasRole(interaction, TOURNAMENT_HOST_ROLE_ID)) {
          return interaction.reply({ content: "You do not have permission to host tournaments.", ephemeral: true });
        }
        const ft         = interaction.options.getInteger("ft");
        const prize      = interaction.options.getString("prize");
        const type       = interaction.options.getString("type");
        const bannedMap  = interaction.options.getString("banned_map") || null;
        const serverLink = interaction.options.getString("server_link") || null;
        const db         = loadDB();
        const tourneyId  = uniqueId(db.tournaments);
        const tournament = {
          id: tourneyId, ft, prize, type, bannedMap, serverLink,
          hostId: interaction.user.id,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          messageId: null, active: true,
          signups: [],
          signupMessageId: null,
          createdAt: new Date().toISOString(),
        };
        const embed        = buildTournamentEmbed(tournament);
        const row          = buildTournamentRow(tournament);
        const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
        tournament.messageId = msg.id;
        db.tournaments[tourneyId] = tournament;
        saveDB(db);
        await updateTournamentSignupCounter(client, tourneyId);
        return;
      }

      if (sub === "cancel") {
        if (!hasRole(interaction, TOURNAMENT_HOST_ROLE_ID)) {
          return interaction.reply({ content: "You do not have permission to cancel tournaments.", ephemeral: true });
        }
        const id = interaction.options.getString("id").trim().toUpperCase();
        const db = loadDB();
        const tournament = db.tournaments[id];
        if (!tournament || !tournament.active) {
          return interaction.reply({ content: `No active tournament found with ID \`${id}\`.`, ephemeral: true });
        }
        if (tournament.messageId) {
          try {
            const channel = await interaction.guild.channels.fetch(tournament.channelId);
            const msg = await channel.messages.fetch(tournament.messageId);
            if (msg) {
              await msg.edit({
                embeds: [buildTournamentEmbed(tournament).setTitle("Tournament Cancelled").setColor(0xed4245)],
                components: [],
              });
            }
          } catch (err) { console.error("Tournament cancel message error:", err.message); }
        }
        db.tournaments[id].active = false;
        saveDB(db);
        return interaction.reply({ content: `Tournament \`${id}\` has been cancelled.`, ephemeral: true });
      }
    }

    // ── /ticket ────────────────────────────────────────────────────────────[...]
    if (interaction.isChatInputCommand() && interaction.commandName === "ticket") {
      if (interaction.options.getSubcommand() === "close") {
        const db = loadDB();
        const ticket = Object.values(db.tryouts).find(
          (t) => t.channelId === interaction.channelId && t.open
        );
        if (!ticket) {
          return interaction.reply({ content: "This channel is not an open ticket.", ephemeral: true });
        }
        const isTryoutManager = hasRole(interaction, TRYOUT_MANAGER_ROLE_ID);
        const isTicketOwner   = ticket.userId === interaction.user.id;
        if (!isTryoutManager && !isTicketOwner) {
          return interaction.reply({ content: "You do not have permission to close this ticket.", ephemeral: true });
        }
        await interaction.reply({ content: "Closing ticket in 3 seconds..." });
        db.tryouts[ticket.id].open = false;
        saveDB(db);
        setTimeout(async () => {
          try {
            const ch = await interaction.guild.channels.fetch(ticket.channelId);
            if (ch) await ch.delete("Ticket closed via command.");
          } catch (err) { console.error("Ticket delete error:", err.message); }
        }, 3000);
      }
    }

    // ── Modal Submissions ──────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      // Tryout form submission
      if (interaction.customId === "tryout_form_modal") {
        const robloxUsername = interaction.fields.getTextInputValue("tryout_roblox_username");
        const platform = interaction.fields.getTextInputValue("tryout_platform");
        const serverLink = interaction.fields.getTextInputValue("tryout_server_link");

        await interaction.deferReply({ ephemeral: true });

        const db = loadDB();

        // Prevent duplicate open tickets from the same user
        const existing = Object.values(db.tryouts).find(
          (t) => t.userId === interaction.user.id && t.open && t.guildId === interaction.guildId
        );
        if (existing) {
          return interaction.editReply({ content: `You already have an open ticket: <#${existing.channelId}>` });
        }

        db.ticketCounter += 1;
        const ticketNum = padTicketNumber(db.ticketCounter);
        const ticketId  = db.ticketCounter;
        saveDB(db);

        let ticketChannel = null;
        try {
          ticketChannel = await interaction.guild.channels.create({
            name: `ticket-${ticketNum}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
              { id: interaction.guild.id,       deny:  [PermissionFlagsBits.ViewChannel] },
              { id: interaction.user.id,         allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
              { id: TRYOUT_MANAGER_ROLE_ID,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
              { id: client.user.id,              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
            ],
            reason: `Tryout ticket for ${interaction.user.tag}`,
          });
        } catch (err) {
          console.error("Ticket channel creation error:", err.message);
          return interaction.editReply({ content: "Failed to create your ticket channel. Make sure the bot has the **Manage Channels** permission." });
        }

        const formEmbed = new EmbedBuilder()
          .setTitle("Tryout Request Form")
          .setColor(0x5865f2)
          .addFields(
            { name: "Roblox username", value: robloxUsername, inline: false },
            { name: "Platform", value: platform, inline: false },
            { name: "Private server link", value: serverLink, inline: false }
          )
          .setTimestamp();

        const welcomeEmbed = new EmbedBuilder()
          .setDescription("Support will be with you shortly.\nTo close this ticket press the close button.")
          .setColor(0x57f287);

        await ticketChannel.send({
          content: `<@${interaction.user.id}> Welcome, Kindly wait till our <@&${TRYOUT_MANAGER_ROLE_ID}> responds to the ticket`,
          embeds: [welcomeEmbed, formEmbed],
          components: [buildCloseRow(ticketId)],
        });

        db.tryouts[ticketId] = {
          id: ticketId, ticketNum,
          userId: interaction.user.id,
          channelId: ticketChannel.id,
          guildId: interaction.guildId,
          open: true,
          formData: { robloxUsername, platform, serverLink },
          createdAt: new Date().toISOString(),
        };
        saveDB(db);

        return interaction.editReply({ content: `Your ticket has been created: <#${ticketChannel.id}>` });
      }

      // Tournament signup form submission
      if (interaction.customId.startsWith("tournament_signup_form_")) {
        const tournamentId = interaction.customId.replace("tournament_signup_form_", "");
        const robloxUsername = interaction.fields.getTextInputValue("tournament_roblox_username");
        const rank = interaction.fields.getTextInputValue("tournament_rank");
        const discordUsername = interaction.fields.getTextInputValue("tournament_discord_username");

        const db = loadDB();
        const tournament = db.tournaments[tournamentId];
        if (!tournament) {
          return interaction.reply({ content: "Tournament not found.", ephemeral: true });
        }

        // Send DM to tournament host
        try {
          const hostUser = await client.users.fetch(tournament.hostId);
          const signupEmbed = new EmbedBuilder()
            .setTitle("New Tournament Sign Up")
            .setColor(0xe67e22)
            .addFields(
              { name: "Tournament", value: tournamentId, inline: false },
              { name: "Roblox username", value: robloxUsername, inline: true },
              { name: "Rank", value: rank, inline: true },
              { name: "Discord username", value: discordUsername, inline: true },
              { name: "Applicant", value: `<@${interaction.user.id}>`, inline: false }
            )
            .setTimestamp();

          await hostUser.send({
            embeds: [signupEmbed],
            components: [buildTournamentApprovalRow(tournamentId, interaction.user.id)],
          });
        } catch (err) {
          console.error("Failed to send DM to tournament host:", err.message);
          return interaction.reply({ content: "Failed to send your application to the host.", ephemeral: true });
        }

        await interaction.reply({ content: "Your application has been sent to the tournament host! Please wait for their response.", ephemeral: true });
      }
    }

    // ── Buttons ────────────────────────────────────────────────────────────[...]
    if (interaction.isButton()) {
      const { customId } = interaction;

      // Join League button
      if (customId.startsWith("join_league_")) {
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
        const isFull  = updated.players.length >= updated.maxPlayers;
        if (isFull) db.leagues[leagueId].active = false;
        saveDB(db);

        if (updated.threadId) {
          try {
            const thread = await interaction.guild.channels.fetch(updated.threadId);
            if (thread) {
              await thread.members.add(interaction.user.id);
              await thread.send(`<@${interaction.user.id}> has joined the league. (${updated.players.length} / ${updated.maxPlayers})`);
              if (isFull) {
                const allMentions = updated.players.map((p) => `<@${p}>`).join(" ");
                await thread.send(`${allMentions}\n\nThe league is now full!\n\n**Format:** ${updated.format}  |  **Match Type:** ${updated.matchType}  |  **Perks:** ${updated.perks}  |  **Region:** ${updated.region}`);
              }
            }
          } catch (err) { console.error("Thread join error:", err.message); }
        }

        await interaction.update({ embeds: [buildLeagueEmbed(updated)], components: [buildJoinRow(leagueId, isFull)] });
        return;
      }

      // Tournament signup button
      if (customId.startsWith("tournament_signup_")) {
        const tournamentId = customId.replace("tournament_signup_", "");
        await interaction.showModal(buildTournamentSignupModal(tournamentId));
        return;
      }

      // Tournament accept button
      if (customId.startsWith("tournament_accept_")) {
        const parts = customId.replace("tournament_accept_", "").split("_");
        const tournamentId = parts[0];
        const userId = parts[1];

        const db = loadDB();
        const tournament = db.tournaments[tournamentId];
        if (!tournament) {
          return interaction.reply({ content: "Tournament not found.", ephemeral: true });
        }

        // Check if user is the host
        if (interaction.user.id !== tournament.hostId) {
          return interaction.reply({ content: "Only the tournament host can accept signups.", ephemeral: true });
        }

        // Add user to signups
        if (!tournament.signups) tournament.signups = [];
        if (!tournament.signups.includes(userId)) {
          tournament.signups.push(userId);
          db.tournaments[tournamentId] = tournament;
          saveDB(db);
        }

        await interaction.reply({ content: `Accepted <@${userId}> for the tournament!`, ephemeral: true });
        await updateTournamentSignupCounter(client, tournamentId);

        // Try to DM the applicant
        try {
          const user = await client.users.fetch(userId);
          await user.send(`You have been accepted for tournament **${tournamentId}**!`);
        } catch (err) {
          console.log("Could not DM user:", err.message);
        }
        return;
      }

      // Tournament decline button
      if (customId.startsWith("tournament_decline_")) {
        const parts = customId.replace("tournament_decline_", "").split("_");
        const tournamentId = parts[0];
        const userId = parts[1];

        const db = loadDB();
        const tournament = db.tournaments[tournamentId];
        if (!tournament) {
          return interaction.reply({ content: "Tournament not found.", ephemeral: true });
        }

        // Check if user is the host
        if (interaction.user.id !== tournament.hostId) {
          return interaction.reply({ content: "Only the tournament host can decline signups.", ephemeral: true });
        }

        await interaction.reply({ content: `Declined <@${userId}> for the tournament.`, ephemeral: true });

        // Try to DM the applicant
        try {
          const user = await client.users.fetch(userId);
          await user.send(`You have been declined for tournament **${tournamentId}**.`);
        } catch (err) {
          console.log("Could not DM user:", err.message);
        }
        return;
      }

      // Create Tryout Ticket button
      if (customId === "create_tryout_ticket") {
        await interaction.showModal(buildTryoutFormModal());
        return;
      }

      // Close Ticket button
      if (customId.startsWith("close_ticket_")) {
        const ticketId = customId.replace("close_ticket_", "");
        const db = loadDB();
        const ticket = db.tryouts[ticketId];
        if (!ticket || !ticket.open) {
          return interaction.reply({ content: "This ticket is already closed.", ephemeral: true });
        }
        const isTryoutManager = hasRole(interaction, TRYOUT_MANAGER_ROLE_ID);
        const isTicketOwner   = ticket.userId === interaction.user.id;
        if (!isTryoutManager && !isTicketOwner) {
          return interaction.reply({ content: "You do not have permission to close this ticket.", ephemeral: true });
        }
        await interaction.reply({ content: "Closing ticket in 3 seconds..." });
        db.tryouts[ticketId].open = false;
        saveDB(db);
        setTimeout(async () => {
          try {
            const ch = await interaction.guild.channels.fetch(ticket.channelId);
            if (ch) await ch.delete("Ticket closed.");
          } catch (err) { console.error("Ticket delete error:", err.message); }
        }, 3000);
      }
    }

  } catch (err) {
    console.error("Interaction error:", err.message);
    // Try to respond if the interaction hasn't been acknowledged yet
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Something went wrong. Please try again.", ephemeral: true });
      }
    } catch (_) {}
  }
});

// ─── Startup Checks ───────────────────────────────────────────────────────[...]
if (!TOKEN)     { console.error("Missing DISCORD_TOKEN."); process.exit(1); }
if (!CLIENT_ID) { console.error("Missing CLIENT_ID.");     process.exit(1); }

client.login(TOKEN).catch((err) => {
  console.error("Login failed:", err.message);
  process.exit(1);
});
