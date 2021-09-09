const AWS = require("aws-sdk");
const dynamoDocumentClient = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS({apiVersion: '2012-11-05'});
const lambda = new AWS.Lambda();

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const { circuitBreaker } = require("src/util/circuitBreaker");
const circuitBreakerClient = new circuitBreaker(dynamoDocumentClient);

exports.handler = async (event, context) => {
    const initialCircuitStatus = await circuitBreakerClient.fetchStatus();
    if (!initialCircuitStatus) {
        console.log('initialising circuit breaker');
        await circuitBreakerClient.close();
    }

    let messagesToProcessPerInvoke = 100;
    let messagesProcessed = 0;
    let coolDownPeriodInMs = 100;

    // loop forever, or maybe invoke itself after a while. Might be better than while true
    while (messagesProcessed < messagesToProcessPerInvoke) {
        await circuitBreakerClient.fetchStatus();
        console.log(`On the ${messagesProcessed} message the circuit is marked as ${circuitBreakerClient.status}`)

        if (circuitBreakerClient.isOpen()) {
            console.log(`Delaying for ${coolDownPeriodInMs}ms to see if airtable API is still rate limited`);
            await sleep(coolDownPeriodInMs);

            const statusUrl = `${process.env.AIRTABLE_API_HOST}${process.env.AIRTABLE_BASE}/${process.env.AIRTABLE_TABLE}?api_key=${process.env.AIRTABLE_API_KEY}`;

            // launch some kind of test API that can close it
            const response = await fetch(statusUrl, { method: 'GET'});
            const statusCode = response.status;

            if (statusCode === 200) {
                console.log('status call ok. Closing circuit');
                await circuitBreakerClient.close();
                coolDownPeriodInMs = 100;
            } else {
                console.log(`status call not ok. Status code is ${response.status}`);

                if (coolDownPeriodInMs > 30000) {
                    await lambda.invoke({
                        InvocationType: 'Event',
                        FunctionName: context.functionName,
                    }).promise();

                    return { message: `Stopped orchestrator and retriggered itself. Processed ${messagesProcessed} messages`, event };
                }

                coolDownPeriodInMs = coolDownPeriodInMs*2;
            }
        }

        if (circuitBreakerClient.isClosed()) {
            // fetch SQS jobs in batches
            const params = {
                QueueUrl: process.env.QUEUE_URL,
                MaxNumberOfMessages: 10,
            };
            const { Messages }  = await sqs.receiveMessage(params).promise(); //10

            if (!Messages) {
                console.log('no messages, sleeping for 500ms');
                await sleep(500)
                continue;
            }

            for (const message of Messages) {
                console.log(`Processing job #${messagesProcessed}`);
                if (circuitBreakerClient.isOpen()) {
                    continue; //do not invoke lambdas if the circuit is open
                }

                await lambda.invoke({
                    InvocationType: 'Event',
                    FunctionName: process.env.FUNCTION_TO_TRIGGER,
                    Payload: JSON.stringify(message, null, 2)
                }).promise();

                messagesProcessed++;
            }
        }
    }

    await lambda.invoke({
        InvocationType: 'Event',
        FunctionName: context.functionName,
    }).promise();

    return { message: `Stopped orchestrator and retriggered itself. Processed ${messagesProcessed} messages`, event };
};



function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
