// Create a DocumentClient that represents the query to add an item
const AWS = require('aws-sdk');
const kinesisStreams = new AWS.Kinesis();
const ion = require('ion-js');
const deagg = require('aws-kinesis-agg');
const computeChecksums = true;


/**
 * Promisified function to deaggregate Kinesis record
 * @param record An individual Kinesis record from the aggregated records
 * @returns The resolved Promise object containing the deaggregated records
 */
const promiseDeaggregate = (record) => new Promise((resolve, reject) => {
  deagg.deaggregateSync(record, computeChecksums, (err, responseObject) => {
    if (err) {
      // handle/report error
      return reject(err);
    }
    console.log('About to resolve the promiseDeaggregate function');
    return resolve(responseObject);
  });
});


async function processRecords(records) {
  console.log(`In the processRecords function with: ${JSON.stringify(records)}`);
  await Promise.all(
      records.map(async (record) => {
        // Kinesis data is base64 encoded so decode here
        const payload = Buffer.from(record.data, 'base64');

        // payload is the actual ion binary record published by QLDB to the stream
        const ionRecord = ion.load(payload);
        console.log(`ionRecord: ${ionRecord}`);  
      }),
  );
}

exports.lambda_handler = async (event, context) => {
    console.log('In the get-dlq-message handler');
    console.log(JSON.stringify(event, null, 2));

    for(const record of event.Records) {
      const { body } = record;
      console.log(`RECORD: ${JSON.stringify(record)}`);
      const msg = JSON.parse(body);
      const shardId =  msg.KinesisBatchInfo.shardId;
      const startSequenceNumber =  msg.KinesisBatchInfo.startSequenceNumber;
      const streamName = process.env.StreamName;

      try {
        const iterator = await getShardIterator(shardId, streamName, startSequenceNumber);

        const records = await kinesisStreams.getRecords(iterator).promise();
        const strRecords = JSON.stringify(records);
        const objRecords = JSON.parse(strRecords);

        await Promise.all(
          objRecords.Records.map(async (msg) => {
            console.log(`in the promise.all about to promise the deaggregation: ${msg}`);
            console.log(`String: ${JSON.stringify(msg)}`);
            console.log(`String Data: ${JSON.stringify(msg.Data)}`);

            const qldbRecords = await promiseDeaggregate(msg.Data);
            await processRecords(qldbRecords);
          }),
        );
        console.log('Finished processing in get-dql-message handler');
      } catch(err) {
        console.log(`Error: " ${err}`);
      }
    }
};

async function getShardIterator(shardId, streamName, startSequenceNumber) {
  const params = {
    ShardId: shardId,
    ShardIteratorType: "AT_SEQUENCE_NUMBER",
    StreamName: streamName,
    StartingSequenceNumber: startSequenceNumber
  };

  console.log('PARAMS: ' + JSON.stringify(params));
  return await kinesisStreams.getShardIterator(params).promise();
}