require('dotenv').config();
// const { Client, GatewayIntentBits } = require('discord.js');
const { 
  Client, GatewayIntentBits, 
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  AudioPlayerStatus
} = require('@discordjs/voice');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ytDlpWrap = new YTDlpWrap();

const songQueue = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// 播放模式列表
const PLAY_MODES = ['正常播放', '循環播放', '隨機播放', '單曲循環'];


client.once('ready', () => {
  console.log('機器人已上線！');
});

// 播放函式
async function playSong(guild, index) {
  const serverQueue = songQueue.get(guild.id);
  
  if (!serverQueue) return;

  // 確保 player 是乾淨的
  if (!serverQueue.player) {
    serverQueue.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    if (serverQueue.connection) {
      serverQueue.connection.subscribe(serverQueue.player);
    }
  } else {
    serverQueue.player.removeAllListeners();
  }


  const song = serverQueue.songs[index];
  if (!song) {
    await clearControlPanel(serverQueue);

    if (serverQueue.connection && serverQueue.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      try {
        serverQueue.connection.destroy();
      } catch (e) {
        console.error(`[${guild.id}] 退出語音時發生錯誤：`, e);
      }
    }

    try {
      serverQueue.player.stop(true);
      serverQueue.player.removeAllListeners();
    } catch (e) {
      console.error(`[${guild.id}] 清理播放器錯誤：`, e);
    }

    if (serverQueue.textChannel) {
      serverQueue.textChannel.send('✅ 播放清單已結束，機器人退出語音頻道。');
    }

    songQueue.delete(guild.id);
    return;
  }

  console.log(`[${guild.id}] 開始播放：${song.url}`);
  console.log(`[${guild.id}] 當前清單長度：${serverQueue.songs.length}`);

  try {

    // await updateControlPanel(serverQueue);
    
    const metadata = await ytDlpWrap.getVideoInfo(song.url);
    const audioFormat = metadata.formats.find(f => f.acodec !== 'none' && f.vcodec === 'none');
    const streamUrl = audioFormat.url;


    console.log(`[${guild.id}] 取得串流 URL 成功：${metadata.title}`);

    const resource = createAudioResource(streamUrl, { inlineVolume: true });
    resource.volume.setVolume(0.2); // 設為 50% 音量
    serverQueue.player.play(resource);

    serverQueue.currentSong = { title: metadata.title, url: song.url };
    serverQueue.currentIndex = index;

    serverQueue.textChannel.send(`▶️ 開始播放： **${metadata.title}**`);

    // 監聽狀態變更
    serverQueue.player.on('stateChange', (oldState, newState) => {
      console.log(`[${guild.id}] 狀態變更：${oldState.status} -> ${newState.status}`);
    });

    serverQueue.player.once(AudioPlayerStatus.Idle, () => {
      console.log(`[${guild.id}] 觸發 Idle，切換下一首`);
      handleSongEnd(guild);
      // const finished = serverQueue.currentSong;
      // if (finished) {
      //   serverQueue.textChannel.send(`⏹ 播放完畢： **${finished.title}**`);
      //   console.log("播放完畢：", finished.title,"\n");
      // }
      // serverQueue.currentIndex++;
      // playSong(guild);
      // playSong(guild, serverQueue.songs[serverQueue.currentIndex]); // 播放下一首
    });

  } catch (error) {
    console.error(`[${guild.id}] 播放錯誤`, error);
    // serverQueue.songs.shift();
    playSong(guild);
    // playSong(guild, serverQueue.songs[0]);
  }
}

function handleSongEnd(guild) {
  const serverQueue = songQueue.get(guild.id);
  if (!serverQueue) return;

  const mode = serverQueue.playMode || "正常播放";
  let nextIndex;

  switch (mode) {
    case "正常播放":
      nextIndex = serverQueue.currentIndex + 1;
      if (nextIndex >= serverQueue.songs.length) {
        playSong(guild, null); // 觸發結束清單
        return;
      }
      break;

    case "循環播放":
      nextIndex = (serverQueue.currentIndex + 1) % serverQueue.songs.length;
      break;

    case "隨機播放":
      nextIndex = Math.floor(Math.random() * serverQueue.songs.length);
      break;

    case "單曲循環":
      nextIndex = serverQueue.currentIndex;
      break;
  }

  playSong(guild, nextIndex);
}

//控制面板按鈕
async function updateControlPanel(serverQueue, type = "create") {
  // 如果舊的存在就刪除
  if (serverQueue.controlMessage&&type == "create") {
    try { await serverQueue.controlMessage.delete(); } catch {}
  }

  // 上一首、暫停/下一首按鈕
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('prev_song')
      .setLabel('⏮ 上一首')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('toggle_pause')
      .setLabel('⏯ 暫停/繼續')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('next_song')
      .setLabel('⏭ 下一首')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('switch_playmode')
      .setLabel(`🔁 ${serverQueue.playMode || '正常播放'}`)
      .setStyle(ButtonStyle.Success)
  );

  // 刪除播放清單按鈕放在新的一列
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('delete_playlist')
      .setLabel('❌ 刪除播放清單')
      .setStyle(ButtonStyle.Danger)
  );

  // 用 Embed 增強版面
  const embed = new EmbedBuilder()
    .setColor(0x1DB954) // Spotify 綠
    .setTitle('🎶 播放控制面板')
    .setDescription(`**目前播放：**\n${serverQueue.currentSong?.title || '未知歌曲'}\n**播放模式：** ${serverQueue.playMode || '正常播放'}`)
    .setTimestamp()
    .setFooter({ text: '使用按鈕控制播放' });

  // 發送控制面板
  // serverQueue.controlMessage = await serverQueue.textChannel.send({
  //   embeds: [embed],
  //   components: [row1, row2]
  // });
  if (type === "edit" && serverQueue.controlMessage) {
      // === 編輯現有面板 ===
      await serverQueue.controlMessage.edit({
        embeds: [embed],
        components: [row1, row2]
      });
    } else {
      // === 建立新面板 ===
      serverQueue.controlMessage = await serverQueue.textChannel.send({
        embeds: [embed],
        components: [row1, row2]
      });
    }
}

//按鈕互動
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const serverQueue = songQueue.get(interaction.guild.id);
  if (!serverQueue) return;

  switch(interaction.customId) {

    case 'toggle_pause':
      if (serverQueue.player.state.status === AudioPlayerStatus.Playing) {
        serverQueue.player.pause();
        await interaction.reply({ content: '⏸ 已暫停播放', ephemeral: true });
      } else if (serverQueue.player.state.status === AudioPlayerStatus.Paused) {
        serverQueue.player.unpause();
        await interaction.reply({ content: '▶️ 已繼續播放', ephemeral: true });
      } else {
        await interaction.reply({ content: '⚠️ 沒有正在播放的歌曲', ephemeral: true });
      }
    break;

    case 'prev_song':
      if (serverQueue.currentIndex > 0) {
        // 先回應，避免交互失敗
        await interaction.deferUpdate();
        serverQueue.currentIndex--;
        playSong(interaction.guild,serverQueue.currentIndex);
        // await interaction.reply({ content: '⏮ 已播放上一首', ephemeral: true });
      } else {
        await interaction.reply({ content: '⚠️ 沒有上一首歌曲', ephemeral: true });
      }
      break;

    case 'next_song':
      if (serverQueue.currentIndex < serverQueue.songs.length - 1) {
        // 先回應，避免交互失敗
        await interaction.deferUpdate();
        serverQueue.currentIndex++;
        playSong(interaction.guild, serverQueue.currentIndex);
        // await interaction.reply({ content: '⏭ 已播放下一首', ephemeral: true });
      } else {
        await interaction.reply({ content: '⚠️ 沒有下一首歌曲', ephemeral: true });
      }
      break;
      
      
    case 'switch_playmode':
      // 先回應，避免交互失敗
      await interaction.deferUpdate();
        // 找出目前模式在列表中的位置
      const currentIndex = PLAY_MODES.indexOf(serverQueue.playMode || '正常播放');
      // 切換到下一個模式
      const nextIndex = (currentIndex + 1) % PLAY_MODES.length;
      serverQueue.playMode = PLAY_MODES[nextIndex];

      // 更新控制面板
      await updateControlPanel(serverQueue,"edit");

      // await interaction.reply({
      //   content: `🔁 已切換播放模式：**${serverQueue.playMode}**`,
      //   ephemeral: true
      // });
      break;

    case 'delete_playlist':
      if (!serverQueue) return interaction.reply({ content: '沒有播放清單。', ephemeral: true });

      // 問使用者是否確認刪除
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('confirm_delete')
          .setLabel('✅ 確認刪除')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel_delete')
          .setLabel('❌ 取消')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        content: '⚠ 你確定要刪除目前的播放清單嗎？',
        components: [confirmRow],
        ephemeral: true
      });
    break;

    case 'confirm_delete':
      if (serverQueue) {
        try {
          serverQueue.player.stop(true);
          serverQueue.player.removeAllListeners();
        } catch (e) {
          console.error(`[${interaction.guildId}] 停止播放器錯誤：`, e);
        }

        if (serverQueue.connection && serverQueue.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          try {
            serverQueue.connection.destroy();
          } catch (e) {
            console.error(`[${interaction.guildId}] 退出語音錯誤：`, e);
          }
        }

        if (serverQueue.controlMessage) {
          serverQueue.controlMessage.delete().catch(() => {});
        }

        // ❗最後再刪掉 Queue
        songQueue.delete(interaction.guildId);
      }

      await interaction.update({ content: '✅ 播放清單已刪除，已退出語音頻道。', components: [] });
    break;

    case 'cancel_delete':
      await interaction.update({ content: '❌ 已取消刪除。', components: [] });
    break;
  }
});


client.on('messageCreate', async message => {
  if (message.author.bot) return;

  if (message.content.startsWith('!play')) {
    const args = message.content.split(' ');
    const url = args[1];
    if (!url) return message.reply('請提供一個 YouTube 網址！');

    let cleanedUrl;
    try {
      const urlObject = new URL(url);
      const videoId = urlObject.searchParams.get('v');
      if (!videoId) return message.reply('這似乎不是有效的 YouTube 影片網址。');
      cleanedUrl = `https://www.youtube.com/watch?v=${videoId}`;
    } catch (e) {
      return message.reply('請提供格式正確的網址！');
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('你需要先加入一個語音頻道！');

    let serverQueue = songQueue.get(message.guild.id);
    const song = { url: cleanedUrl };

    if (!serverQueue) {
      console.log(`[${message.guild.id}] 建立新的播放清單`);
      const queueConstruct = {
        connection: null,
        currentIndex: 0,
        player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } }),
        songs: [],
        textChannel: message.channel,
        currentSong: null,
        controlMessage: null,
        lastPanelTs: 0,
        updatingPanel: false,
        playMode: '正常播放'
      };
      songQueue.set(message.guild.id, queueConstruct);
      queueConstruct.songs.push(song);

      try {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });
        queueConstruct.connection = connection;
        connection.subscribe(queueConstruct.player);

        console.log(`[${message.guild.id}] 已成功連接語音頻道`);
        playSong(message.guild, 0);
        // playSong(message.guild, queueConstruct.songs[0]);
        message.reply(`🎵 已加入播放清單並準備開始播放！`);

      } catch (error) {
        console.error(`[${message.guild.id}] 連接語音錯誤`, error);
        songQueue.delete(message.guild.id);
        return message.reply('無法加入語音頻道！');
      }

    } else {
      console.log(`[${message.guild.id}] 新增歌曲到清單：${song.url}`);
      serverQueue.songs.push(song);
      message.reply(`✅ 已加入播放清單！目前清單長度：${serverQueue.songs.length}`);
    }
  }

  if (message.content === '!queue') {
    const serverQueue = songQueue.get(message.guild.id);
    if (!serverQueue || serverQueue.songs.length === 0) {
      return message.reply('目前播放清單是空的。');
    }

    let queueMessage = `🎶 **播放清單**\n`;
    serverQueue.songs.forEach((song, index) => {
      // if (index === 0) {
      //   queueMessage += `▶️ 現正播放： ${serverQueue.currentSong?.title || '未知歌曲'}\n`;
      // } else {
      //   queueMessage += `${index}. ${song.url}\n`;
      // }
      if (index === serverQueue.currentIndex) {
        queueMessage += `▶️ 現正播放： ${serverQueue.currentSong?.title || '未知歌曲'}\n`;
      } else {
        queueMessage += `${index}. ${song.url}\n`;
      }
    });
    message.channel.send(queueMessage);
  }

  if (message.content === '!nowplaying') {
    const serverQueue = songQueue.get(message.guild.id);
    if (!serverQueue || !serverQueue.currentSong) {
      return message.reply('目前沒有正在播放的歌曲。');
    }
    message.channel.send(`🎧 正在播放： **${serverQueue.currentSong.title}**\n${serverQueue.currentSong.url}`);
  }
});

// === 保持控制面板在最底下 ===
client.on('messageCreate', async (message) => {
  // 忽略 DM
  if (!message.guild) return;

  const serverQueue = songQueue.get(message.guild.id);
  if (!serverQueue) return;
  
  if (serverQueue.updatingPanel) return;
  serverQueue.updatingPanel = true;

  if (!serverQueue || !serverQueue.player) return;
  if (serverQueue.songs.length === 0) return; // 沒歌不用面板

  // 🚫 忽略控制面板本身
  // if (serverQueue.controlMessage && message.id == serverQueue.controlMessage.id) return;
  // if (message.author.bot) return;
  // if (serverQueue.controlMessage && message.id === serverQueue.controlMessage.id) {
  //   serverQueue.updatingPanel = false;
  //   return;
  // }

  try {
    await updateControlPanel(serverQueue);

    // serverQueue.controlMessage = newMsg;
  } catch (err) {
    console.error('更新控制面板失敗：', err);
  } finally {
    serverQueue.updatingPanel = false;
  }
});

// === 播放完畢時清除控制面板 ===
async function clearControlPanel(serverQueue) {
  if (serverQueue.controlMessage) {
    try { await serverQueue.controlMessage.delete(); } catch {}
    serverQueue.controlMessage = null;
  }
}

client.login(process.env.DISCORD_TOKEN);
