/*
 * Lambda function that consumes messages from a Kinesis data stream that uses the
 * Kinesis Aggregated Data Format
 */
const Log = require('@dazn/lambda-powertools-logger');
const deagg = require('aws-kinesis-agg');
const ion = require('ion-js');

const computeChecksums = true;
const REVISION_DETAILS = "REVISION_DETAILS";



/**
 * Processes each Ion record, and takes the appropriate action to
 * create, update or delete a record in DynamoDB
 * @param ionRecord The Ion data loaded from a Uint8Array
 */
async function processIon(ionRecord) {
  // retrieve the version and id from the metadata section of the message
  const version = ionRecord.payload.revision.metadata.version.numberValue();

  const id = ionRecord.payload.revision.metadata.id.stringValue();

  Log.debug(`Version ${version} and id ${id}`);

  // Check to see if the data section exists.
  if (ionRecord.payload.revision.data == null) {
    Log.debug('No data section so handle as a delete');
    await deleteLicence(id, version);
  } else {
    const points = ionRecord.payload.revision.data.penaltyPoints.numberValue();
    const postcode = ionRecord.payload.revision.data.postcode.stringValue();

    Log.debug(`id: ${id}, points: ${points}, postcode: ${postcode}`);

    // do an upsert so it doesn't matter if it is the initial version or not
    await updateLicence(id, points, postcode, version);
  }
}

/**
 * Processes each deaggregated Kinesis record in order. The function
 * ignores all records apart from those of typee REVISION_DETAILS
 * @param records The deaggregated Kinesis records to be processed
 */
async function processRecords(records) {
  await Promise.all(
    records.map(async (record) => {
      // Kinesis data is base64 encoded so decode here
      const payload = Buffer.from(record.data, 'base64');

      // payload is the actual ion binary record published by QLDB to the stream
      const ionRecord = ion.load(payload);

      // Only process records where the record type is REVISION_DETAILS
      if (ionRecord.recordType.stringValue() !== REVISION_DETAILS) {
        Log.debug(`Skipping record of type ${ion.dumpPrettyText(ionRecord.recordType)}`);
      } else {
        Log.debug(`Ion Record: ${ion.dumpPrettyText(ionRecord.payload)}`);
        throw new Error("Testing out the DLQ");
      }
    }),
  );
}

module.exports.handler = async (event, context) => {
  Log.debug(`In ${context.functionName} processing ${event.Records.length} Kinesis Input Records`);
  // eslint-disable-next-line no-console
  console.log(`** PRINT MSG: ${JSON.stringify(event, null, 2)}`);
  await Promise.all(
    event.Records.map(async (kinesisRecord) => {
      const records = await promiseDeaggregate(kinesisRecord.kinesis);
      await processRecords(records);
    }),
  );
  Log.debug('Finished processing in qldb-stream handler');
};


