const AWS = require("aws-sdk");
const uuid = require("uuid");
const sqs = new AWS.SQS({apiVersion: '2012-11-05'});
const request = require('request-promise-native');
const lambda = new AWS.Lambda();

const API_ENDPOINT = process.env.PREZLY_API_HOST;
const TOKEN = process.env.PREZLY_API_TOKEN;
const PAGE_SIZE = process.env.PREZLY_PAGE_SIZE;

exports.handler = async (event, context) => {
    let messagesAdded = 0;
    let offset = event.offset ?? 0;

    log(`Getting contacts from API (in blocks of ${PAGE_SIZE})`);

    const { pagination, contacts } = await reqUsers(offset, PAGE_SIZE);
    const { total_records_number} = pagination;
    const chunksCount = Math.round(total_records_number / PAGE_SIZE);

    const sqsPromises = [];
    contacts.forEach((contact) => {
        sqsPromises.push(addToSqs(contact));
    });

    console.log(`Waiting for all promises`);
    await Promise.all(sqsPromises);

    console.log(`Offset ${offset} < Chunks ${chunksCount}`);
    if (offset <= chunksCount) {
        await lambda.invoke({
            InvocationType: 'Event',
            FunctionName: context.functionName,
            Payload: JSON.stringify({ offset: offset+1 }, null, 2)
        }).promise();

        return { message: `Added jobs and queued myself. Added ${messagesAdded} contacts to queue`, event };
    }

    return { message: `Added ${messagesAdded} contacts to queue. Last batch/page. Exiting` };
};


const addToSqs = async (contact) => {
    const params = {
        QueueUrl: process.env.QUEUE_URL,
        MessageBody: JSON.stringify(contact),
    };

    return sqs.sendMessage(params).promise();
}

const reqUsers = (offset, pageSize = PAGE_SIZE) => {

    const userReq = {
        uri: API_ENDPOINT ,
        method: 'POST',
        qs: {
            limit: pageSize,
            sort: '-created_at',
            offset: offset
        },
        json: true,
        headers: {
            "Authorization": `Bearer ${TOKEN}`,
        }
    };

    return request(userReq);
}

const log = (message) => {
    if (process.env.LOGGING === 'true') {
        console.log(message);
    }
}
