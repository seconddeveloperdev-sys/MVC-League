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
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const TOKEN    = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const LEAGUE_CHANNEL_ID    = '1498804106628956211';
const LEAGUE_HOST_ROLE_ID  = '1459877884645740846';
const LEAGUES_PING_ROLE_ID = '1451553808697266257';

// ─── Database ─────────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'database.json');

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ leagues: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateLeagueId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getMaxPlayers(format) {
  return { '2v2': 4, '3v3': 6, '4v4': 8 }[format] || 4;
}

function formatRegion(r) {
  return {
    europe:        'Europe',
    asia:          'Asia',
    north_america: 'North America',
    south_america: 'South America',
    oceania:       'Oceania',
  }[r] || r;
}

function formatType(t)  { return t === 'swift' ? 'Swift Game' : 'War Game'; }
function formatPerks(p) { return p === 'perks' ? 'Perks' : 'No Perks'; }

// ─── Embeds ───────────────────────────────────────────────────────────────────
function buildLeagueEmbed(league) {
  const spotsLeft = league.maxPlayers - league.players.length;
  const isFull    = spotsLeft === 0;

  return new EmbedBuilder()
    .setTitle(isFull ? 'League — Full' : 'League — Open')
    .setColor(isFull ? 0xED4245 : 0x5865F2)
    .addFields(
      { name: 'Format',     value: league.format,               inline: true },
      { name: 'Match Type', value: formatType(league.type),     inline: true },
      { name: 'Perks',      value: formatPerks(league.perks),   inline: true },
      { name: 'Region',     value: formatRegion(league.region), inline: true },
      { name: 'Host',       value: `<@${league.hostId}>`,       inline: true },
      { name: 'Players',    value: `${league.players.length} / ${league.maxPlayers}`, inline: true },
      { name: 'Spots Left', value: `${spotsLeft}`,              inline: true },
      { name: 'League ID',  value: `\`${league.id}\``,          inline: true },
    )
    .setFooter({ text: isFull ? 'This league is full.' : 'Press the button below to join.' })
    .setTimestamp();
}

function buildJoinRow(leagueId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_league_${leagueId}`)
      .setLabel('Join League')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
}

// ─── Slash command definitions ────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('league')
    .setDescription('League management')
    .addSubcommand(sub =>
      sub
        .setName('host')
        .setDescription('Host a new league')
        .addStringOption(opt =>
          opt.setName('format').setDescription('Match format').setRequired(true)
            .addChoices(
              { name: '2v2', value: '2v2' },
              { name: '3v3', value: '3v3' },
              { name: '4v4', value: '4v4' },
            ),
        )
        .addStringOption(opt =>
          opt.setName('type').setDescription('Match type').setRequired(true)
            .addChoices(
              { name: 'Swift Game', value: 'swift' },
              { name: 'War Game',   value: 'war'   },
            ),
        )
        .addStringOption(opt =>
          opt.setName('perks').setDescription('Match perks').setRequired(true)
            .addChoices(
              { name: 'Perks',    value: 'perks'    },
              { name: 'No Perks', value: 'no_perks' },
            ),
        )
        .addStringOption(opt =>
          opt.setName('region').setDescription('Region').setRequired(true)
            .addChoices(
              { name: 'Europe',        value: 'europe'        },
              { name: 'Asia',          value: 'asia'          },
              { name: 'North America', value: 'north_america' },
              { name: 'South America', value: 'south_america' },
              { name: 'Oceania',       value: 'oceania'       },
            ),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('cancel')
        .setDescription('Cancel an active league')
        .addStringOption(opt =>
          opt.setName('id').setDescription('League ID').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add a player to a league')
        .addStringOption(opt =>
          opt.setName('id').setDescription('League ID').setRequired(true),
        )
        .addUserOption(opt =>
          opt.setName('player').setDescription('Player to add').setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a player from a league')
        .addStringOption(opt =>
          opt.setName('id').setDescription('League ID').setRequired(true),
        )
        .addUserOption(opt =>
          opt.setName('player').setDescription('Player to remove').setRequired(true),
        ),
    )
    .toJSON(),
];

// ─── Client ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once('ready', async () => {
  console.log(`Ready — logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(client.application.id, GUILD_ID), { body: commands });
      console.log(`Commands registered to guild ${GUILD_ID}.`);
    } else {
      await rest.put(Routes.applicationCommands(client.application.id), { body: commands });
      console.log('Commands registered globally.');
    }
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

// ─── Interaction handler ──────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ════════════════════════════════
  // Slash commands
  // ════════════════════════════════
  if (interaction.isChatInputCommand() && interaction.commandName === 'league') {
    const sub = interaction.options.getSubcommand();

    // ────────────────────────────────────────────────────────
    // /league host
    // ────────────────────────────────────────────────────────
    if (sub === 'host') {
      if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE_ID)) {
        return interaction.reply({ content: 'You do not have permission to host leagues.', ephemeral: true });
      }
      if (interaction.channelId !== LEAGUE_CHANNEL_ID) {
        return interaction.reply({ content: `Leagues can only be hosted in <#${LEAGUE_CHANNEL_ID}>.`, ephemeral: true });
      }

      await interaction.deferReply();

      const format     = interaction.options.getString('format');
      const type       = interaction.options.getString('type');
      const perks      = interaction.options.getString('perks');
      const region     = interaction.options.getString('region');
      const leagueId   = generateLeagueId();
      const maxPlayers = getMaxPlayers(format);

      const league = {
        id:        leagueId,
        hostId:    interaction.user.id,
        format, type, perks, region,
        maxPlayers,
        players:   [interaction.user.id], // host is auto-joined
        messageId: null,
        channelId: interaction.channelId,
        guildId:   interaction.guildId,
        active:    true,
        threadId:  null,
      };

      // Create private thread immediately
      let thread = null;
      try {
        const ch = await client.channels.fetch(league.channelId);
        thread = await ch.threads.create({
          name:      `League ${leagueId} — ${league.format} ${formatType(league.type)}`,
          type:      ChannelType.PrivateThread,
          invitable: false,
        });
        league.threadId = thread.id;

        // Add the host to the thread right away
        await thread.members.add(interaction.user.id);

        await thread.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('League Created')
              .setColor(0x5865F2)
              .setDescription('This is your private league thread. Additional players will appear here as they join.')
              .addFields(
                { name: 'Format',     value: league.format,               inline: true },
                { name: 'Match Type', value: formatType(league.type),     inline: true },
                { name: 'Perks',      value: formatPerks(league.perks),   inline: true },
                { name: 'Region',     value: formatRegion(league.region), inline: true },
                { name: 'Host',       value: `<@${league.hostId}>`,       inline: true },
                { name: 'League ID',  value: `\`${league.id}\``,          inline: true },
              )
              .setFooter({ text: 'Only players who join the league can see this thread.' })
              .setTimestamp(),
          ],
        });
      } catch (err) {
        console.error('Failed to create private thread:', err);
      }

      // Post the public announcement embed
      const embed = buildLeagueEmbed(league);
      const row   = buildJoinRow(leagueId);

      const msg = await interaction.editReply({
        content:    `<@&${LEAGUES_PING_ROLE_ID}>`,
        embeds:     [embed],
        components: [row],
      });

      league.messageId = msg.id;

      const db = readDB();
      db.leagues[leagueId] = league;
      writeDB(db);
      return;
    }

    // ────────────────────────────────────────────────────────
    // /league cancel
    // ────────────────────────────────────────────────────────
    if (sub === 'cancel') {
      if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE_ID)) {
        return interaction.reply({ content: 'You do not have permission to cancel leagues.', ephemeral: true });
      }

      const leagueId = interaction.options.getString('id').toUpperCase();
      const db       = readDB();
      const league   = db.leagues[leagueId];

      if (!league) {
        return interaction.reply({ content: `No league found with ID \`${leagueId}\`.`, ephemeral: true });
      }
      if (league.cancelled) {
        return interaction.reply({ content: `League \`${leagueId}\` has already been cancelled.`, ephemeral: true });
      }

      await interaction.deferReply();

      // Delete the private thread
      if (league.threadId) {
        try {
          const thread = await client.channels.fetch(league.threadId);
          if (thread) await thread.delete();
        } catch (_) {}
      }

      // Delete the public announcement message
      try {
        const ch  = await client.channels.fetch(league.channelId);
        const msg = await ch.messages.fetch(league.messageId);
        await msg.delete();
      } catch (_) {}

      league.active    = false;
      league.cancelled = true;
      db.leagues[leagueId] = league;
      writeDB(db);

      // Visible to everyone — not ephemeral
      return interaction.editReply({
        content: `League \`${leagueId}\` has been cancelled by <@${interaction.user.id}>.`,
      });
    }

    // ────────────────────────────────────────────────────────
    // /league add
    // ────────────────────────────────────────────────────────
    if (sub === 'add') {
      if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE_ID)) {
        return interaction.reply({ content: 'You do not have permission to manage leagues.', ephemeral: true });
      }

      const leagueId   = interaction.options.getString('id').toUpperCase();
      const targetUser = interaction.options.getUser('player');
      const db         = readDB();
      const league     = db.leagues[leagueId];

      if (!league) {
        return interaction.reply({ content: `No league found with ID \`${leagueId}\`.`, ephemeral: true });
      }
      if (!league.active) {
        return interaction.reply({ content: `League \`${leagueId}\` is no longer active.`, ephemeral: true });
      }
      if (league.players.includes(targetUser.id)) {
        return interaction.reply({ content: `<@${targetUser.id}> is already in this league.`, ephemeral: true });
      }
      if (league.players.length >= league.maxPlayers) {
        return interaction.reply({ content: `League \`${leagueId}\` is already full.`, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      league.players.push(targetUser.id);
      const isFull = league.players.length >= league.maxPlayers;

      // Add to the private thread
      if (league.threadId) {
        try {
          const thread = await client.channels.fetch(league.threadId);
          await thread.members.add(targetUser.id);
          await thread.send(`<@${targetUser.id}> has been added to the league by <@${interaction.user.id}>.`);
        } catch (err) {
          console.error('Failed to add member to thread:', err);
        }
      }

      // Update public embed
      try {
        const ch  = await client.channels.fetch(league.channelId);
        const msg = await ch.messages.fetch(league.messageId);
        await msg.edit({
          embeds:     [buildLeagueEmbed(league)],
          components: [buildJoinRow(leagueId, isFull)],
        });
      } catch (_) {}

      if (isFull) league.active = false;
      db.leagues[leagueId] = league;
      writeDB(db);

      return interaction.editReply({ content: `<@${targetUser.id}> has been added to league \`${leagueId}\`.` });
    }

    // ────────────────────────────────────────────────────────
    // /league remove
    // ────────────────────────────────────────────────────────
    if (sub === 'remove') {
      if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE_ID)) {
        return interaction.reply({ content: 'You do not have permission to manage leagues.', ephemeral: true });
      }

      const leagueId   = interaction.options.getString('id').toUpperCase();
      const targetUser = interaction.options.getUser('player');
      const db         = readDB();
      const league     = db.leagues[leagueId];

      if (!league) {
        return interaction.reply({ content: `No league found with ID \`${leagueId}\`.`, ephemeral: true });
      }
      if (!league.players.includes(targetUser.id)) {
        return interaction.reply({ content: `<@${targetUser.id}> is not in league \`${leagueId}\`.`, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      // Remove from players list
      league.players = league.players.filter(id => id !== targetUser.id);

      // Re-open the league if it was full
      if (!league.active) league.active = true;

      // Remove from the private thread
      if (league.threadId) {
        try {
          const thread = await client.channels.fetch(league.threadId);
          await thread.members.remove(targetUser.id);
          await thread.send(`<@${targetUser.id}> has been removed from the league.`);
        } catch (err) {
          console.error('Failed to remove member from thread:', err);
        }
      }

      // Update public embed and re-enable join button
      try {
        const ch  = await client.channels.fetch(league.channelId);
        const msg = await ch.messages.fetch(league.messageId);
        await msg.edit({
          embeds:     [buildLeagueEmbed(league)],
          components: [buildJoinRow(leagueId, false)],
        });
      } catch (_) {}

      db.leagues[leagueId] = league;
      writeDB(db);

      return interaction.editReply({ content: `<@${targetUser.id}> has been removed from league \`${leagueId}\`. The spot is now open.` });
    }
  }

  // ════════════════════════════════
  // Button: Join League
  // ════════════════════════════════
  if (interaction.isButton() && interaction.customId.startsWith('join_league_')) {
    const leagueId = interaction.customId.replace('join_league_', '');
    const db       = readDB();
    const league   = db.leagues[leagueId];

    if (!league || !league.active) {
      return interaction.reply({ content: 'This league is no longer open.', ephemeral: true });
    }
    if (league.players.includes(interaction.user.id)) {
      return interaction.reply({ content: 'You are already in this league.', ephemeral: true });
    }
    if (league.players.length >= league.maxPlayers) {
      return interaction.reply({ content: 'This league is full.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    league.players.push(interaction.user.id);
    const isFull = league.players.length >= league.maxPlayers;
    if (isFull) league.active = false;

    // Add the new player to the existing private thread
    if (league.threadId) {
      try {
        const thread = await client.channels.fetch(league.threadId);
        await thread.members.add(interaction.user.id);
        await thread.send(`<@${interaction.user.id}> has joined the league. ( ${league.players.length} / ${league.maxPlayers} )`);

        if (isFull) {
          const pingList   = league.players.map(id => `<@${id}>`).join(' ');
          const playerList = league.players.map(id => `<@${id}>`).join('\n');

          await thread.send({
            content: `${pingList}`,
            embeds: [
              new EmbedBuilder()
                .setTitle('League — Full. Get Ready.')
                .setColor(0x57F287)
                .addFields(
                  { name: 'Format',     value: league.format,               inline: true },
                  { name: 'Match Type', value: formatType(league.type),     inline: true },
                  { name: 'Perks',      value: formatPerks(league.perks),   inline: true },
                  { name: 'Region',     value: formatRegion(league.region), inline: true },
                  { name: 'Host',       value: `<@${league.hostId}>`,       inline: true },
                  { name: 'League ID',  value: `\`${league.id}\``,          inline: true },
                  { name: 'Players',    value: playerList,                  inline: false },
                )
                .setFooter({ text: 'All spots filled. The league begins now.' })
                .setTimestamp(),
            ],
          });
        }
      } catch (err) {
        console.error('Failed to add player to thread:', err);
      }
    }

    // Update the public embed
    try {
      await interaction.message.edit({
        embeds:     [buildLeagueEmbed(league)],
        components: [buildJoinRow(leagueId, isFull)],
      });
    } catch (_) {}

    db.leagues[leagueId] = league;
    writeDB(db);

    return interaction.editReply({
      content: isFull
        ? `You have joined league \`${leagueId}\`. The league is now full — check your private thread.`
        : `You have joined league \`${leagueId}\`. Check your private thread. Waiting for more players.`,
    });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
if (!TOKEN) {
  console.error('DISCORD_TOKEN is not set. Exiting.');
  process.exit(1);
}

client.login(TOKEN);
