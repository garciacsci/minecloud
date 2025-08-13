import {
  CdkCustomResourceEvent,
  CdkCustomResourceResponse,
  Context
} from 'aws-lambda';
import axios from 'axios';
import { getFullDiscordCommand } from '../shared_util';

// Add this helper function
interface Delay {
  (ms: number): Promise<void>;
}

const delay: Delay = (ms: number): Promise<void> =>
  new Promise((resolve: () => void) => setTimeout(resolve, ms));

// The deployment will fail if exception was thrown.
exports.handler = async (event: CdkCustomResourceEvent, context: Context) => {
  if (event.RequestType !== 'Delete') {
    const apiEndpoint = `https://discord.com/api/v10/applications/${process.env.APP_ID}/commands`;

    // Add 1 second delay between each command registration
    await registerCommand(
      getFullDiscordCommand('start'),
      'Start the server',
      apiEndpoint
    );
    await delay(1000);
    await registerCommand(
      getFullDiscordCommand('stop'),
      'Stop the server',
      apiEndpoint
    );
    await delay(1000);
    await registerCommand(
      getFullDiscordCommand('restart'),
      'Restart the server system service',
      apiEndpoint
    );
    await delay(1000);
    await registerCommand(
      getFullDiscordCommand('backup'),
      'Stop the server and make a backup',
      apiEndpoint
    );
    await delay(1000);
    await registerCommand(
      getFullDiscordCommand('backup_download'),
      'Get the latest backup',
      apiEndpoint
    );
    await delay(1000);
    await registerCommand(
      getFullDiscordCommand('status'),
      'Check server status and player count',
      apiEndpoint
    );
    await delay(1000);
    await registerCommand(
      getFullDiscordCommand('players'),
      'List all online players',
      apiEndpoint
    );
    await delay(1000);
    await registerCommand(
      getFullDiscordCommand('leaderboard'),
      'Display player statistics and playtime leaderboard',
      apiEndpoint
    );
  }

  const response: CdkCustomResourceResponse = {
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    PhysicalResourceId: context.logGroupName
  };

  response.Status = 'SUCCESS';
  response.Data = { Result: 'None' };
  return response;
};

async function registerCommand(
  commandName: string,
  description: string,
  endPoint: string,
  maxRetries = 3
) {
  const header = {
    Authorization: `Bot ${process.env.BOT_TOKEN}`
  };
  const body = {
    name: commandName,
    type: 1,
    description: description
  };

  let retries = 0;
  while (retries <= maxRetries) {
    try {
      console.log(
        `Registering command: ${commandName} (attempt ${retries + 1})`
      );
      const response = await axios({
        method: 'post',
        url: endPoint,
        headers: header,
        data: body
      });
      console.log(`Successfully registered command: ${commandName}`);
      return true;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        (error as any).response &&
        (error as any).response.status === 429
      ) {
        // Extract retry-after header if available
        const retryAfter = (error as any).response.headers['retry-after'] || 2;
        const waitTime = parseInt(retryAfter, 10) * 1000;
        console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
        await delay(waitTime);
        retries++;
      } else {
        console.error(
          `Error registering command ${commandName}:`,
          (error as any).message || error
        );
        throw error;
      }
    }
  }
  return false;
}
