# airtable-sync

This repository syncs [Prezly](https://www.prezly.com) contact data with an airtable base.

## Tech components

* Node/Javascript
* [Simple Notification Service](https://aws.amazon.com/sns/)
* Prezly API
* Airtable API
* [Serverless](https://www.serverless.com/framework/docs/)
* [Circuit Breaker Pattern](https://github.com/digitalbase/lambda-circuitbreaker-node)
* [AirtablePlus SDK](https://airtable-plus.js.org/)
* dotenv

##  How does it work ?

Four lambda functions:

* initialise: Listens to an endpoint (HTTP) and starts the sync
* queue_jobs: Pages Prezly API and adds 1 message per contact to queue
* orchestrator: Executes sync jobs while making sure we don't reach airtable rate limit (circuit breaker)
* sync: Take the contact payload and create or update an airtable record

## Installing

Make sure to have serverless.yml and installed to use your AWS account. Read more in their [getting started guide](https://www.serverless.com/framework/docs/getting-started/) and how to [authorise AWS](https://www.serverless.com/framework/docs/providers/aws/guide/credentials/).

```
serverless config credentials --provider aws --key YOUR_KEY --secret YOUR_SECRET
```

Fill in .env.production with the variables  you need

```
cp .env.example.production .env.production
npm install
NODE_ENV=production sls deploy
```
