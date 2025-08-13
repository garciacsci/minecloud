import { Context } from 'aws-lambda';
import * as AWS from 'aws-sdk';
import axios from 'axios';
import { getFullDiscordCommand } from '../shared_util';
import { DOMAIN_NAME } from '../../MineCloud-Service-Info';

const InstanceIds = [process.env.INSTANCE_ID!];
const ec2_instance_region = process.env.EC2_REGION;
let responseToken = '';

const SSM = new AWS.SSM();
const ec2 = new AWS.EC2({ region: ec2_instance_region });

exports.handler = async (event: any, context: Context) => {
  console.log('event: ', event);

  const body = JSON.parse(event.body);

  responseToken = body.token;
  console.log('responseToken: ', responseToken);

  const commandName = body.data.name;
  console.log('commandName: ', commandName);

  if (commandName == getFullDiscordCommand('start')) {
    try {
      const result = await ec2.startInstances({ InstanceIds }).promise();
      console.log('startInstances succeed, result: \n', result);
      await sendDeferredResponse('🚀 Starting server instance...');
    } catch (err) {
      console.error(`startInstances error: \n`, err);
      await sendDeferredResponse(
        getAWSErrorMessageTemplate('starting server instance', err)
      );
      await sendDeferredResponse('⏱️ Try again in a minute');
    }
  }

  if (commandName == getFullDiscordCommand('stop')) {
    try {
      const result = await ec2.stopInstances({ InstanceIds }).promise();
      console.log('stopInstance suceeed, result: \n', result);
      await sendDeferredResponse('🛑 Shutting down server instance');
    } catch (err) {
      console.error(`stopInstance error: \n`, err);
      await sendDeferredResponse(
        getAWSErrorMessageTemplate('stopping server instance', err)
      );
    }
  }

  if (commandName == getFullDiscordCommand('restart')) {
    try {
      const result = await sendCommands(['sudo systemctl restart minecloud']);
      console.log('mc_restart result: ', result);
      await sendDeferredResponse('🔄 Restarting server...');
    } catch (err) {
      console.error(`mc_restart error: \n`, err);
      await sendDeferredResponse(
        getAWSErrorMessageTemplate('restarting server service', err)
      );
    }
  }

  if (commandName == getFullDiscordCommand('backup')) {
    try {
      const result = await sendCommands([
        'cd /opt/minecloud/',
        'sudo ./server_manual_backup.sh'
      ]);
      console.log('mc_backup result: ', result);
      await sendDeferredResponse('💾 Creating backup...');
    } catch (err) {
      console.error(`mc_backup error: \n`, err);
      await sendDeferredResponse(
        getAWSErrorMessageTemplate('making backup', err)
      );
    }
  }

  if (commandName == getFullDiscordCommand('backup_download')) {
    const s3 = new AWS.S3({ signatureVersion: 'v4' });

    const bucketName: string = process.env.BACKUP_BUCKET_NAME as string;
    const s3Objects = await s3.listObjectsV2({ Bucket: bucketName }).promise();

    if (s3Objects.Contents && s3Objects.Contents.length > 0) {
      let s3ObjectKeys = s3Objects.Contents.map((x) => x.Key);
      s3ObjectKeys = s3ObjectKeys.sort((a, b) => (a! > b! ? -1 : 1));

      const latestBackupKey = s3ObjectKeys[0];

      const params = {
        Bucket: bucketName,
        Key: latestBackupKey,
        Expires: 3600
      };
      const preSignedUrl = await s3.getSignedUrl('getObject', params);
      await sendDeferredResponse(
        `📦 Download link for ${latestBackupKey}:\n ${preSignedUrl}`
      );
    } else {
      await sendDeferredResponse('❓ No backups found');
    }
  }

  if (commandName == getFullDiscordCommand('status')) {
    try {
      // Check instance status
      const instanceStatus = await ec2
        .describeInstances({ InstanceIds })
        .promise();
      const instance = instanceStatus.Reservations?.[0]?.Instances?.[0];

      if (!instance) {
        await sendDeferredResponse('❓ Unable to find server instance');
        return;
      }

      const state = instance.State?.Name;
      let statusMessage = '';

      if (state === 'running') {
        try {
          // Get connection count, uptime, and domain name from the server
          const result = await sendCommands([
            'cd /opt/minecloud/',
            'echo "$(source ./get_connection_count.sh && get_current_connection_count)"',
            'uptime -p',
            'aws ec2 describe-tags --region $(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone | sed "s/[a-z]$//") --filters "Name=resource-id,Values=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)" --query "Tags[?Key==\'DOMAIN_NAME\'].Value" --output text'
          ]);

          // Wait for command execution
          await new Promise((resolve) => setTimeout(resolve, 1500));

          // Get command invocation result
          const commandId = result.Command?.CommandId;
          const invocation = await SSM.getCommandInvocation({
            CommandId: commandId!,
            InstanceId: InstanceIds[0]
          }).promise();

          const output = invocation.StandardOutputContent || '';
          const lines = output.trim().split('\n');

          // Parse connection count, uptime, and domain name
          const connectionCount = lines[0] || '0';
          const uptime = lines[1] || 'unknown';
          const domainName = DOMAIN_NAME;

          // Get address to display (DNS name if domain exists, IP otherwise)
          let addressDisplay = '';
          if (domainName) {
            addressDisplay = `• Address: \`minecloud.${domainName}\``;
          } else {
            const publicIp =
              instance.PublicIpAddress || 'No public IP assigned';
            addressDisplay = `• IP: \`${publicIp}\``;
          }

          statusMessage =
            `📊 **Server Status**\n` +
            `• Status: 🟢 Online\n` +
            `• Players: ${connectionCount} connected\n` +
            `• Uptime: ${uptime}\n` +
            addressDisplay;
        } catch (err) {
          console.error('Error getting server details:', err);

          // Attempt to get domain name even if other details fail
          try {
            const domainResult = await sendCommands([
              'aws ec2 describe-tags --region $(curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone | sed "s/[a-z]$//") --filters "Name=resource-id,Values=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)" --query "Tags[?Key==\'DOMAIN_NAME\'].Value" --output text'
            ]);

            await new Promise((resolve) => setTimeout(resolve, 1000));

            const domainCmdId = domainResult.Command?.CommandId;
            const domainInvocation = await SSM.getCommandInvocation({
              CommandId: domainCmdId!,
              InstanceId: InstanceIds[0]
            }).promise();

            const domainName = domainInvocation.StandardOutputContent?.trim();

            if (domainName) {
              statusMessage =
                `📊 **Server Status**\n` +
                `• Status: 🟡 Running but may be initializing\n` +
                `• Address: \`minecloud.${domainName}\``;
            } else {
              statusMessage =
                `📊 **Server Status**\n` +
                `• Status: 🟡 Running but may be initializing\n` +
                `• IP: \`${instance.PublicIpAddress || 'No public IP assigned'}\``;
            }
          } catch (domainErr) {
            statusMessage =
              `📊 **Server Status**\n` +
              `• Status: 🟡 Running but may be initializing\n` +
              `• IP: \`${instance.PublicIpAddress || 'No public IP assigned'}\``;
          }
        }
      } else if (state === 'pending') {
        statusMessage = '📊 **Server Status**\n• Status: 🟠 Starting up';
      } else if (state === 'stopping' || state === 'shutting-down') {
        statusMessage = '📊 **Server Status**\n• Status: 🟠 Shutting down';
      } else if (state === 'stopped') {
        statusMessage = '📊 **Server Status**\n• Status: ⚫ Offline (stopped)';
      } else {
        statusMessage = `📊 **Server Status**\n• Status: ⚫ ${state}`;
      }

      await sendDeferredResponse(statusMessage);
    } catch (err) {
      console.error(`status check error: \n`, err);
      await sendDeferredResponse(
        getAWSErrorMessageTemplate('checking server status', err)
      );
    }
  }

  if (commandName == getFullDiscordCommand('players')) {
    try {
      // Check instance status first
      const instanceStatus = await ec2
        .describeInstances({ InstanceIds })
        .promise();
      const instance = instanceStatus.Reservations?.[0]?.Instances?.[0];

      if (!instance) {
        await sendDeferredResponse('❓ Unable to find server instance');
        return;
      }

      const state = instance.State?.Name;

      if (state !== 'running') {
        await sendDeferredResponse(
          `⚠️ Server is not running (current state: ${state}). Start the server to view players.`
        );
        return;
      }

      try {
        // Get detailed player list from the server using a command appropriate for your game server
        // For Minecraft, we can use the 'list' command in the server console
        const result = await sendCommands([
          'cd /opt/minecloud/',
          // Use screen to send a 'list' command to the server and capture output
          'sudo screen -S mc_server -X stuff "list^M"',
          // Wait briefly for command to execute
          'sleep 1',
          // Use grep to extract the most recent player list from logs
          'sudo grep -a "\\[Server thread/INFO\\]: There are" /opt/minecloud/server/logs/latest.log | tail -1'
        ]);

        // Wait for command execution
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Get command invocation result
        const commandId = result.Command?.CommandId;
        const invocation = await SSM.getCommandInvocation({
          CommandId: commandId!,
          InstanceId: InstanceIds[0]
        }).promise();

        const output = invocation.StandardOutputContent || '';

        // Parse player list from output
        // Expected format: "[Server thread/INFO]: There are X of a max of Y players online: player1, player2, ..."
        let playerMessage = '';
        const playerListMatch = output.match(
          /There are \d+ of a max of \d+ players online: (.*)/
        );

        if (
          playerListMatch &&
          playerListMatch[1] &&
          playerListMatch[1].trim() !== ''
        ) {
          // We have players online
          const playerList = playerListMatch[1].split(',').map((p) => p.trim());
          playerMessage = `👥 **Online Players (${playerList.length})**\n`;

          // List all players with bullet points
          playerList.forEach((player) => {
            playerMessage += `• ${player}\n`;
          });
        } else if (output.includes('There are 0')) {
          // No players online
          playerMessage = '👤 **No players currently online**';
        } else {
          // Unable to parse output
          playerMessage =
            '⚠️ **Unable to retrieve player list**\nServer may still be starting up or not responding to commands.';
        }

        await sendDeferredResponse(playerMessage);
      } catch (err) {
        console.error('Error getting player list:', err);
        await sendDeferredResponse(
          getAWSErrorMessageTemplate('retrieving player list', err)
        );
      }
    } catch (err) {
      console.error(`players command error: \n`, err);
      await sendDeferredResponse(
        getAWSErrorMessageTemplate('checking server status', err)
      );
    }
  }

  if (commandName == getFullDiscordCommand('leaderboard')) {
    try {
      // Check instance status first
      const instanceStatus = await ec2
        .describeInstances({ InstanceIds })
        .promise();
      const instance = instanceStatus.Reservations?.[0]?.Instances?.[0];

      if (!instance) {
        await sendDeferredResponse('❓ Unable to find server instance');
        return;
      }

      const state = instance.State?.Name;

      if (state !== 'running') {
        await sendDeferredResponse(
          `⚠️ Server is not running (current state: ${state}). Start the server to view leaderboard.`
        );
        return;
      }

      try {
        // Get player stats using a combination of available data sources
        const result = await sendCommands([
          'cd /opt/minecloud/',
          // Find all player data files
          'find world/stats -name "*.json" 2>/dev/null || echo "No stats files found"',
          // List advancements for potential achievement counting
          'find world/advancements -name "*.json" 2>/dev/null || echo "No advancement files found"',
          // Get server start time for uptime calculation
          'stat -c %Y world/level.dat 2>/dev/null || echo "0"'
        ]);

        // Wait for command execution
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Get command invocation result
        const commandId = result.Command?.CommandId;
        const invocation = await SSM.getCommandInvocation({
          CommandId: commandId!,
          InstanceId: InstanceIds[0]
        }).promise();

        const output = invocation.StandardOutputContent || '';
        const lines = output.trim().split('\n');

        // Get all player stat files
        const statFiles = [];
        let i = 0;
        while (
          i < lines.length &&
          lines[i] !== 'No stats files found' &&
          !lines[i].startsWith('find:')
        ) {
          if (lines[i].endsWith('.json') && lines[i].includes('stats')) {
            statFiles.push(lines[i]);
          }
          i++;
        }

        if (statFiles.length === 0) {
          await sendDeferredResponse(
            '📊 **Player Leaderboard**\nNo player statistics available yet. Players need to join the server first!'
          );
          return;
        }

        // Process each player's stats to extract playtime data
        const playerStatsPromises = statFiles.map(async (statFile) => {
          const statsResult = await sendCommands([
            `cat ${statFile} 2>/dev/null || echo "{}"`
          ]);

          await new Promise((resolve) => setTimeout(resolve, 500));

          const statsCommandId = statsResult.Command?.CommandId;
          const statsInvocation = await SSM.getCommandInvocation({
            CommandId: statsCommandId!,
            InstanceId: InstanceIds[0]
          }).promise();

          const statsContent = statsInvocation.StandardOutputContent || '{}';
          let stats;

          try {
            stats = JSON.parse(statsContent);
          } catch (e) {
            console.error(`Error parsing stats for ${statFile}:`, e);
            stats = {};
          }

          // Extract player name from filename (UUID format)
          const playerUuid =
            statFile.split('/').pop()?.replace('.json', '') || '';

          // Get player name from UUID if possible
          const usercacheResult = await sendCommands([
            'cat world/usernamecache.json 2>/dev/null || echo "{}"'
          ]);

          await new Promise((resolve) => setTimeout(resolve, 500));

          const usercacheCommandId = usercacheResult.Command?.CommandId;
          const usercacheInvocation = await SSM.getCommandInvocation({
            CommandId: usercacheCommandId!,
            InstanceId: InstanceIds[0]
          }).promise();

          let playerName = playerUuid;
          try {
            const usercache = JSON.parse(
              usercacheInvocation.StandardOutputContent || '{}'
            );
            playerName = usercache[playerUuid] || playerName;
          } catch (e) {
            console.error('Error parsing usercache:', e);
          }

          // Extract playtime in ticks (1 tick = 0.05 seconds)
          // Different Minecraft versions store playtime differently
          let playtimeTicks = 0;

          // For 1.12+
          if (
            stats.stats &&
            stats.stats['minecraft:custom'] &&
            stats.stats['minecraft:custom']['minecraft:play_time']
          ) {
            playtimeTicks =
              stats.stats['minecraft:custom']['minecraft:play_time'];
          }
          // For 1.13+
          else if (
            stats.stats &&
            stats.stats['minecraft:custom'] &&
            stats.stats['minecraft:custom']['minecraft:play_one_minute']
          ) {
            playtimeTicks =
              stats.stats['minecraft:custom']['minecraft:play_one_minute'];
          }
          // For older versions
          else if (
            stats.stat &&
            stats.stat['minecraft:custom'] &&
            stats.stat['minecraft:custom']['minecraft:play_one_minute']
          ) {
            playtimeTicks =
              stats.stat['minecraft:custom']['minecraft:play_one_minute'];
          }
          // Legacy format
          else if (stats.stat && stats.stat.playOneMinute) {
            playtimeTicks = stats.stat.playOneMinute;
          }

          // Convert ticks to hours (20 ticks per second)
          const playtimeHours = (playtimeTicks / (20 * 60 * 60)).toFixed(1);

          // Try to get other interesting stats
          let mobsKilled = 0;
          let deaths = 0;
          let blocksPlaced = 0;

          // Find mob kills
          if (
            stats.stats &&
            stats.stats['minecraft:custom'] &&
            stats.stats['minecraft:custom']['minecraft:mob_kills']
          ) {
            mobsKilled = stats.stats['minecraft:custom']['minecraft:mob_kills'];
          }

          // Find deaths
          if (
            stats.stats &&
            stats.stats['minecraft:custom'] &&
            stats.stats['minecraft:custom']['minecraft:deaths']
          ) {
            deaths = stats.stats['minecraft:custom']['minecraft:deaths'];
          }

          // Count total blocks placed (simplified)
          if (stats.stats && stats.stats['minecraft:used']) {
            for (const [item, count] of Object.entries(
              stats.stats['minecraft:used']
            )) {
              if (item.includes('block')) {
                blocksPlaced += count as number;
              }
            }
          }

          return {
            name: playerName,
            playtimeHours: parseFloat(playtimeHours),
            mobsKilled,
            deaths,
            blocksPlaced,
            lastPlayed: stats.DataVersion
              ? new Date().toISOString().split('T')[0]
              : 'Unknown' // Approximate - could be improved
          };
        });

        const playerStats = await Promise.all(playerStatsPromises);

        // Sort by playtime (descending)
        playerStats.sort((a, b) => b.playtimeHours - a.playtimeHours);

        // Create the leaderboard message
        let leaderboardMessage = '🏆 **PLAYER LEADERBOARD** 🏆\n\n';

        // Playtime leaderboard
        leaderboardMessage += '⏱️ **Playtime**\n';
        playerStats.slice(0, 5).forEach((player, index) => {
          leaderboardMessage += `${index + 1}. ${player.name}: ${player.playtimeHours} hours\n`;
        });

        // Optional: Add other stat categories if available
        const haveMobKills = playerStats.some((p) => p.mobsKilled > 0);
        if (haveMobKills) {
          leaderboardMessage += '\n☠️ **Mob Kills**\n';
          [...playerStats]
            .sort((a, b) => b.mobsKilled - a.mobsKilled)
            .slice(0, 3)
            .forEach((player, index) => {
              leaderboardMessage += `${index + 1}. ${player.name}: ${player.mobsKilled}\n`;
            });
        }

        const haveDeaths = playerStats.some((p) => p.deaths > 0);
        if (haveDeaths) {
          leaderboardMessage += '\n💀 **Deaths**\n';
          [...playerStats]
            .sort((a, b) => b.deaths - a.deaths)
            .slice(0, 3)
            .forEach((player, index) => {
              leaderboardMessage += `${index + 1}. ${player.name}: ${player.deaths}\n`;
            });
        }

        await sendDeferredResponse(leaderboardMessage);
      } catch (err) {
        console.error('Error getting leaderboard:', err);
        await sendDeferredResponse(
          getAWSErrorMessageTemplate('retrieving player leaderboard', err)
        );
      }
    } catch (err) {
      console.error(`leaderboard command error: \n`, err);
      await sendDeferredResponse(
        getAWSErrorMessageTemplate('checking server status', err)
      );
    }
  }

  return {
    status: 200
  };
};

const apiEndpoint = 'https://discord.com/api/v10/webhooks';
// Send Discord deferred response
async function sendDeferredResponse(message: string) {
  const body = {
    content: message
  };
  const request = {
    method: 'post',
    url: `${apiEndpoint}/${process.env.APP_ID}/${responseToken}`,
    data: body
  };

  const response = await axios(request);
  console.log('sendDeferredResponse result: ', response);
}

async function sendCommands(cmd: string[]) {
  const params = {
    InstanceIds,
    DocumentName: 'AWS-RunShellScript',
    Parameters: {
      commands: cmd
    }
  };
  return SSM.sendCommand(params).promise();
}

function getAWSErrorMessageTemplate(
  actionText: string,
  errorMessage: any
): string {
  // Sanitize error message to avoid leaking sensitive data
  let sanitizedError = '';

  try {
    if (typeof errorMessage === 'object') {
      // Extract just the error type and message, not the full stack trace
      sanitizedError = `${errorMessage.code || 'Unknown'}: ${errorMessage.message || 'No message'}`;
    } else {
      // Use string representation but limit length
      sanitizedError = String(errorMessage).substring(0, 100);
      if (String(errorMessage).length > 100) {
        sanitizedError += '...';
      }
    }
  } catch (e) {
    sanitizedError = 'Unable to process error details';
  }

  return `❌ Error ${actionText}:\n` + '```' + sanitizedError + '```';
}
