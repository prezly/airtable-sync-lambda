const AWS = require("aws-sdk");
const dynamoDocumentClient = new AWS.DynamoDB.DocumentClient();
const sqs = new AWS.SQS({apiVersion: '2012-11-05'});

const moment = require('moment');

const { circuitBreaker } = require("src/util/circuitBreaker");
const circuitBreakerClient = new circuitBreaker(dynamoDocumentClient);

const AirtablePlus = require('airtable-plus');
const airtable = new AirtablePlus({
    baseID: process.env.AIRTABLE_BASE,
    apiKey: process.env.AIRTABLE_KEY,
    tableName: process.env.AIRTABLE_TABLE,
    typecast: true
});


async function fulfillWithTimeLimit(timeLimit, task, failureValue){
    let timeout;
    const timeoutPromise = new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
            resolve(failureValue);
        })
    });
    const response = await Promise.race([task, timeoutPromise]);
    if(timeout){ //the code works without this but let's be safe and clean up the timeout
        clearTimeout(timeout);
    }
    return response;
}

exports.handler = async (event) => {
    const contact = JSON.parse(event.Body);
    const receiptHandle = event.ReceiptHandle;

    await circuitBreakerClient.fetchStatus();
    if (circuitBreakerClient.isOpen()) {
        console.log('Not executing sync. Circuit is open')

        return;
    }

    console.log('Start callAPI');

    const fields = {
        "ID": contact.id,
        "Name": contact.display_name,
        "First Name": contact.first_name,
        "Family Name": contact.last_name,
        "Gender": contact.gender !== 'unspecified' ? contact.gender : null,
        "Type": contact.contact_type,
        "Function": contact.function_name,
        "Email": contact.primary_email,
        "Languages": contact.languages.map(o => {return o.locale;}),
        "Address Street": contact.address.street,
        "Address Number": contact.address.number,
        "Address Box": contact.address.box,
        "Address Zip": contact.address.zip,
        "Address City": contact.address.city,
        "Address Region": contact.address.region,
        "Address Country": contact.address.country,
        "Emails": contact.emails.toString(),
        "Phone Numbers": contact.phone_numbers.filter(i => {return i.number !== '';}).map(o => {return o.number;}).join(','), //can be \n if rich text is on
        "Organisations": contact.organisations.map(o => {return o.display_name;}).join(','), //can be \n if rich text is on
        "Urls": contact.urls.toString(),
        "Tags": contact.tags,
        "created_at_prezly": moment(contact.created_at).toISOString(),
        "modified_at_prezly": moment(contact.modified_at).toISOString(),
        "synced_at": moment().toISOString(),
    };

    //console.log(contact);
    //console.log(fields);

    // inspired on https://medium.com/swlh/set-a-time-limit-on-async-actions-in-javascript-567d7ca018c2
    let timeLimit = 30000; // 1 sec time limit
    const longTask = await airtable.upsert("ID", fields);
    let failureValue = 'timeout'; // this is null for just an example.

    let start = Date.now();
    let data = await fulfillWithTimeLimit(timeLimit, longTask, failureValue);

    if (data === failureValue) {
        const stop = Date.now();
        console.log('function took too long opening circuitbreaker');
        await circuitBreakerClient.open();

        return;
    }

    // success, remove message from SQS
    const params = {
        QueueUrl: process.env.QUEUE_URL,
        ReceiptHandle: receiptHandle
    };

    console.log('removing sqs message', params);
    await sqs.deleteMessage(params).promise();
}


const log = (message) => {
    if (process.env.LOGGING === 'true') {
        console.log(message);
    }
}
