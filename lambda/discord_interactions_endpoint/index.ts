import { Context } from 'aws-lambda';
import { sign } from 'tweetnacl';
import { Lambda } from 'aws-sdk';

exports.handler = async (event: any, context: Context) => {
  const PUBLIC_KEY = process.env.PUBLIC_KEY!;

  // Discord sends these headers for validation
  const signature = event.headers['x-signature-ed25519'];
  const timestamp = event.headers['x-signature-timestamp'];
  const eventBody = event.body;

  // Log request information without sensitive data
  console.log('Request received:', {
    timestamp,
    headers: Object.keys(event.headers),
    bodyLength: eventBody ? eventBody.length : 0,
    path: event.path,
    httpMethod: event.httpMethod
  });

  // 1. Verify the request is coming from Discord
  if (!signature || !timestamp || !eventBody) {
    console.warn('Missing required headers for Discord validation');
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'invalid request' })
    };
  }

  // Verify signature using Ed25519
  try {
    const isVerified = sign.detached.verify(
      Buffer.from(timestamp + eventBody),
      Buffer.from(signature, 'hex'),
      Buffer.from(PUBLIC_KEY, 'hex')
    );

    if (!isVerified) {
      console.warn('Signature verification failed');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'invalid signature' })
      };
    }
  } catch (error) {
    console.error('Error during signature verification:', error);
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'signature verification error' })
    };
  }

  // 2. Parse the request body
  let body;
  try {
    body = JSON.parse(eventBody);
  } catch (error) {
    console.error('Error parsing request body:', error);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid request body' })
    };
  }

  // 3. Handle Discord ping (required for webhook verification)
  if (body.type === 1) {
    return {
      statusCode: 200,
      body: JSON.stringify({ type: 1 })
    };
  }

  // 4. Process commands asynchronously
  try {
    const lambda = new Lambda();
    const res = await lambda
      .invokeAsync({
        FunctionName: process.env.DISCORD_COMMAND_PROCESSOR_FUNCTION_NAME!,
        InvokeArgs: JSON.stringify(event)
      })
      .promise();

    console.log('Command processing lambda invocation result:', res);

    // Return a deferred response to Discord
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: 5 // Deferred response
      })
    };
  } catch (error) {
    console.error('Error invoking command processor:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'command processing failed' })
    };
  }
};
