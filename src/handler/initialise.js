const AWS = require("aws-sdk");
const lambda = new AWS.Lambda();

module.exports.handler = async (event, context) => {

    console.log('Invoking queue jobs function')
    await lambda.invoke({
        InvocationType: 'Event',
        FunctionName: process.env.FUNCTION_TO_TRIGGER,
        //Payload: JSON.stringify(message, null, 2)
    }).promise();


    return {
        statusCode: 200,
        body: JSON.stringify(
            {
                message: "OK",
            },
            null,
            2
        ),
    };
};
