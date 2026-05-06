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
} = require("discord.js");

const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const LEAGUE_CHANNEL_ID = "1462387975022186621";
const LEAGUE_HOST_ROLE_ID = "1500064722312233050";
const LEAGUES_PING_ROLE_ID = "1500068561174003853";

const DB_PATH = "./database.json";

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ leagues: {} }, null, 2));
  }
  const raw = fs.readFileSync(DB_PATH, "utf8");
  return JSON.parse(raw);
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateLeagueId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function getMaxPlayers(format) {
  return parseInt(format.charAt(0)) * 2;
}

function buildLeagueEmbed(league) {
  const spotsLeft = league.maxPlayers - league.players.length;
  const playerList =
    league.players.length > 0
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
      {
        name: "Spots Left",
        value: `${spotsLeft} / ${league.maxPlayers}`,
        inline: true,
      },
      { name: "Players", value: playerList, inline: false },
      { name: "League ID", value: `\`${league.id}\``, inline: false }
    )
    .setFooter({
      text: `Cancel: /league cancel id:${league.id}`,
    })
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

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("league")
      .setDescription("League management commands")
      .addSubcommand((sub) =>
        sub
          .setName("host")
          .setDescription("Host a new league")
          .addStringOption((opt) =>
            opt
              .setName("format")
              .setDescription("Match format")
              .setRequired(true)
              .addChoices(
                { name: "2v2", value: "2v2" },
                { name: "3v3", value: "3v3" },
                { name: "4v4", value: "4v4" }
              )
          )
          .addStringOption((opt) =>
            opt
              .setName("match_type")
              .setDescription("Match type")
              .setRequired(true)
              .addChoices(
                { name: "Swift Game", value: "Swift Game" },
                { name: "War Game", value: "War Game" }
              )
          )
          .addStringOption((opt) =>
            opt
              .setName("perks")
              .setDescription("Match perks")
              .setRequired(true)
              .addChoices(
                { name: "Perks", value: "Perks" },
                { name: "No Perks", value: "No Perks" }
              )
          )
          .addStringOption((opt) =>
            opt
              .setName("region")
              .setDescription("Region")
              .setRequired(true)
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
        sub
          .setName("cancel")
          .setDescription("Cancel an active league")
          .addStringOption((opt) =>
            opt
              .setName("id")
              .setDescription("The League ID to cancel")
              .setRequired(true)
          )
      )
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Registering slash commands globally...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Slash commands registered successfully.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once("ready", async () => {
  console.log(`Bot online: ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
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
      let leagueId;
      do {
        leagueId = generateLeagueId();
      } while (db.leagues[leagueId]);

      try {
        await interaction.deferReply();
      } catch (err) {
        console.error("deferReply error:", err.message);
        return;
      }

      let thread = null;
      try {
        thread = await interaction.channel.threads.create({
          name: `League ${leagueId}`,
          type: ChannelType.PrivateThread,
          autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
          reason: `Private thread for league ${leagueId}`,
          invitable: false,
        });
        await thread.members.add(interaction.user.id);
      } catch (err) {
        console.error("Thread creation error:", err.message);
      }

      const league = {
        id: leagueId,
        format,
        matchType,
        perks,
        region,
        hostId: interaction.user.id,
        maxPlayers,
        players: [interaction.user.id],
        threadId: thread ? thread.id : null,
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        messageId: null,
        active: true,
        createdAt: new Date().toISOString(),
      };

      db.leagues[leagueId] = league;
      saveDB(db);

      const embed = buildLeagueEmbed(league);
      const row = buildJoinRow(leagueId, league.players.length >= maxPlayers);

      try {
        await interaction.channel.send(`<@&${LEAGUES_PING_ROLE_ID}>`);
      } catch (err) {
        console.error("Ping send error:", err.message);
      }

      let msg;
      try {
        msg = await interaction.editReply({
          embeds: [embed],
          components: [row],
        });
      } catch (err) {
        console.error("editReply error:", err.message);
        return;
      }

      db.leagues[leagueId].messageId = msg.id;
      saveDB(db);

      if (thread) {
        try {
          await thread.send(
            `League **${leagueId}** has been opened.\n\n**Format:** ${format}  |  **Match Type:** ${matchType}  |  **Perks:** ${perks}  |  **Region:** ${region}\n\nThis is your private league thread. Players will be added here as they join.`
          );
        } catch (err) {
          console.error("Thread open message error:", err.message);
        }
      }

      return;
    }

    if (sub === "cancel") {
      if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE_ID)) {
        try {
          return await interaction.reply({
            content: "You do not have permission to cancel leagues.",
            ephemeral: true,
          });
        } catch (err) {
          console.error("interaction.reply error:", err.message);
          return;
        }
      }

      const rawId = interaction.options.getString("id");
      const id = rawId.trim().toUpperCase();
      const db = loadDB();
      const league = db.leagues[id];

      if (!league || !league.active) {
        try {
          return await interaction.reply({
            content: `No active league found with ID \`${id}\`.`,
            ephemeral: true,
          });
        } catch (err) {
          console.error("interaction.reply error:", err.message);
          return;
        }
      }

      if (league.threadId) {
        try {
          const thread = await interaction.guild.channels.fetch(league.threadId);
          if (thread) {
            await thread.send(
              `League **${id}** has been cancelled by <@${interaction.user.id}>. This thread will now be archived.`
            );
            await thread.setArchived(true);
          }
        } catch (err) {
          console.error("Thread archive error:", err.message);
        }
      }

      if (league.messageId) {
        try {
          const channel = await interaction.guild.channels.fetch(
            league.channelId
          );
          const msg = await channel.messages.fetch(league.messageId);
          if (msg) {
            const cancelledEmbed = buildLeagueEmbed(league)
              .setTitle("League Cancelled")
              .setColor(0xed4245);
            await msg.edit({
              embeds: [cancelledEmbed],
              components: [buildJoinRow(id, true)],
            });
          }
        } catch (err) {
          console.error("Message edit error:", err.message);
        }
      }

      db.leagues[id].active = false;
      saveDB(db);

      try {
        return await interaction.reply({
          content: `League \`${id}\` has been cancelled.`,
          ephemeral: true,
        });
      } catch (err) {
        console.error("interaction.reply error:", err.message);
      }
    }
  }

  if (interaction.isButton()) {
    const { customId } = interaction;
    if (!customId.startsWith("join_league_")) return;

    const leagueId = customId.replace("join_league_", "");
    const db = loadDB();
    const league = db.leagues[leagueId];

    if (!league || !league.active) {
      try {
        return await interaction.reply({
          content: "This league is no longer active.",
          ephemeral: true,
        });
      } catch (err) {
        console.error("interaction.reply error:", err.message);
        return;
      }
    }

    if (league.players.includes(interaction.user.id)) {
      try {
        return await interaction.reply({
          content: "You have already joined this league.",
          ephemeral: true,
        });
      } catch (err) {
        console.error("interaction.reply error:", err.message);
        return;
      }
    }

    if (league.players.length >= league.maxPlayers) {
      try {
        return await interaction.reply({
          content: "This league is full.",
          ephemeral: true,
        });
      } catch (err) {
        console.error("interaction.reply error:", err.message);
        return;
      }
    }

    db.leagues[leagueId].players.push(interaction.user.id);
    const updatedLeague = db.leagues[leagueId];
    saveDB(db);

    if (updatedLeague.threadId) {
      try {
        const thread = await interaction.guild.channels.fetch(
          updatedLeague.threadId
        );
        if (thread) {
          await thread.members.add(interaction.user.id);
          await thread.send(
            `<@${interaction.user.id}> has joined the league. (${updatedLeague.players.length} / ${updatedLeague.maxPlayers} players)`
          );
        }
      } catch (err) {
        console.error("Thread join error:", err.message);
      }
    }

    const isFull = updatedLeague.players.length >= updatedLeague.maxPlayers;
    const embed = buildLeagueEmbed(updatedLeague);
    const row = buildJoinRow(leagueId, isFull);

    try {
      await interaction.update({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error("interaction.update error:", err.message);
    }

    if (isFull) {
      db.leagues[leagueId].active = false;
      saveDB(db);

      if (updatedLeague.threadId) {
        try {
          const thread = await interaction.guild.channels.fetch(
            updatedLeague.threadId
          );
          if (thread) {
            const allMentions = updatedLeague.players
              .map((p) => `<@${p}>`)
              .join(" ");
            await thread.send(
              `${allMentions}\n\nThe league is now full. All players are confirmed.\n\n**Format:** ${updatedLeague.format}  |  **Match Type:** ${updatedLeague.matchType}  |  **Perks:** ${updatedLeague.perks}  |  **Region:** ${updatedLeague.region}\n\nGood luck.`
            );
          }
        } catch (err) {
          console.error("Thread full message error:", err.message);
        }
      }
    }
  }
});

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error("Missing CLIENT_ID environment variable.");
  process.exit(1);
}

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

client.login(TOKEN).catch((err) => {
  console.error("Login failed:", err.message);
  process.exit(1);
});
