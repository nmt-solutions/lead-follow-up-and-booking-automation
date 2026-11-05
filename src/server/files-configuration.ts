import "server-only";
import { readFilesConfiguration } from "../storage/configuration";

export function filesConfiguration() {
  return readFilesConfiguration(process.env);
}
