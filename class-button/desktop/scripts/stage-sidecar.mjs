import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const executable = process.platform === "win32" ? "class-button-sidecar.exe" : "class-button-sidecar";
const source = path.resolve("..", "target", "release", executable);
const destinationDirectory = path.resolve("build-resources", "bin");
const destination = path.join(destinationDirectory, executable);

await rm(destinationDirectory, { recursive: true, force: true });
await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
if (process.platform !== "win32") await chmod(destination, 0o755);

process.stdout.write(`${destination}\n`);
