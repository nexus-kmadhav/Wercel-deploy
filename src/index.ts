import "dotenv/config";
import { createClient } from "redis";
import { downloadS3Folder } from "./aws.js";
import { buildProject } from "./utils.js";
import { uploadFile } from "./aws.js";
import { getAllFiles } from './file.js';
import path from 'path';

// Files are downloaded to: <cwd>/dist/output/<id>/...
// The built output will be at: <cwd>/dist/output/<id>/dist/
const OUTPUT_BASE = path.join(process.cwd(), "dist", "output");

const redisOptions = process.env.REDIS_URL ? { url: process.env.REDIS_URL } : {};

const subscriber = createClient(redisOptions);
await subscriber.connect();

const publisher = createClient(redisOptions);
await publisher.connect();

async function main() {
  while (true) {
    const res = await subscriber.brPop("build-queue", 0);

    // res is { key: 'build-queue', element: '<id>' }
    console.log(res);
    const id = res?.element as string;

    // 1. Download source from S3 (lands in <cwd>/dist/output/<id>/)
    await downloadS3Folder(id);

    // 2. Build the project (npm install && npm run build inside the folder)
    await buildProject(id);

    // 3. Collect built files from the dist/ subfolder
    const distPath = path.join(OUTPUT_BASE, id, "dist");
    console.log("Uploading from:", distPath);
    const files = getAllFiles(distPath);

    // 4. Upload each file preserving its relative path under dist/
    for (const file of files) {
      const relativePath = path.relative(distPath, file);
      await uploadFile(`${id}/${relativePath}`, file);
    }

    publisher.hSet("status", id, "deployed");
    console.log(`Deployment complete for ${id}`);
  }
}

main();