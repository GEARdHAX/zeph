// Storage abstraction — object storage (R2/S3-compatible) when configured,
// transparent local-disk fallback otherwise. Every upload/serving route
// goes through this interface, never touching `fs`/an S3 client directly,
// so switching a deployment onto real object storage later is an env-var
// change (set R2_ENDPOINT/R2_ACCESS_KEY_ID/etc), not a code change.
//
// R2 is Cloudflare's S3-compatible object storage (see infra/cloudflare.md)
// — using the generic `@aws-sdk/client-s3` package here is not an
// AWS-specific choice, it's the de facto client for the S3 wire protocol
// that R2/MinIO/actual S3 all speak identically via `endpoint` config.
// CLAUDE.md excludes AWS itself as a *hosting* provider, not this protocol.
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const store = require('./store');
const logger = require('./logger');

const useObjectStorage = !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID);

let s3Client = null;
let s3Commands = null;
const getS3 = () => {
  if (!s3Client) {
    // Lazy-required so a local-disk-only deploy never loads the SDK at all.
    const {
      S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
    } = require('@aws-sdk/client-s3');
    s3Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    s3Commands = { PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
  }
  return { client: s3Client, commands: s3Commands };
};

const localPathFor = (key) => path.join(store.config.dataFolder, key);

// readStream: a Node Readable (e.g. fs.createReadStream on formidable's temp
// file). contentType: sniffed/categorized mimetype, never the raw client
// header — callers are responsible for having already validated it.
const putObject = async (key, readStream, contentType) => {
  if (useObjectStorage) {
    const { client, commands } = getS3();
    // R2/S3 need a fully-buffered body or a stream with a known length for
    // some client configurations; formidable's temp file is small enough
    // (capped by mediaPolicy's per-category limits) to buffer safely here.
    const chunks = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of readStream) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    await client.send(new commands.PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return;
  }

  const destPath = localPathFor(key);
  await mkdirp(path.dirname(destPath));
  await new Promise((resolve, reject) => {
    const writable = fs.createWriteStream(destPath);
    readStream.pipe(writable);
    writable.on('finish', resolve);
    writable.on('error', reject);
    readStream.on('error', reject);
  });
};

// Returns a Node Readable stream positioned at the start of the object.
const getObjectStream = async (key) => {
  if (useObjectStorage) {
    const { client, commands } = getS3();
    const res = await client.send(new commands.GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    }));
    return res.Body; // already a Readable in the Node runtime
  }

  const localPath = localPathFor(key);
  await fs.promises.access(localPath, fs.constants.F_OK);
  return fs.createReadStream(localPath);
};

const deleteObject = async (key) => {
  if (useObjectStorage) {
    const { client, commands } = getS3();
    await client.send(new commands.DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    }));
    return;
  }

  try {
    await fs.promises.unlink(localPathFor(key));
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn({ err, key }, 'Failed to delete local media object');
  }
};

module.exports = {
  useObjectStorage, putObject, getObjectStream, deleteObject,
};
