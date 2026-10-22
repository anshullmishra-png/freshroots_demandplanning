import { badRequest } from "@/lib/errors";
import { FILE_KEYS, FILE_NAMES, type FileKey, type UploadFiles } from "@/lib/validation/types";

export interface ParsedUpload {
  files: UploadFiles;
  usePreviousMasters: boolean;
  acknowledgeWarnings: boolean;
}

/** Reads the multipart upload. CSV only (guardrail G-S4); size and row limits are checked by the validator. */
export async function readUpload(req: Request): Promise<ParsedUpload> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("BAD_FORM", "Send the files as multipart form data.");
  }
  const files: UploadFiles = {};
  for (const key of FILE_KEYS as FileKey[]) {
    const value = form.get(key);
    if (value === null || value === "") continue;
    if (typeof value === "string") throw badRequest("BAD_FILE", `${key} must be a file.`);
    if (!value.name.toLowerCase().endsWith(".csv")) {
      throw badRequest("NOT_CSV", `${FILE_NAMES[key]}: only .csv files are accepted (got ${value.name}).`);
    }
    files[key] = await value.text();
  }
  return {
    files,
    usePreviousMasters: form.get("usePreviousMasters") === "true",
    acknowledgeWarnings: form.get("acknowledgeWarnings") === "true",
  };
}
