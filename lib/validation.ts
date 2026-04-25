import { z } from "zod";

export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB

const allowedExtensions = [".html", ".htm"] as const;

export const convertEmailFieldSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .max(320)
  .email("Enter a valid email address");

const extensionSchema = z
  .string()
  .min(1)
  .refine(
    (name) =>
      allowedExtensions.some((ext) => name.toLowerCase().endsWith(ext)),
    { message: "File must be a .html or .htm file" }
  );

const fileSizeBytesSchema = z
  .number()
  .int()
  .min(1, "The uploaded file is empty")
  .max(
    MAX_FILE_BYTES,
    `File size must be at most ${MAX_FILE_BYTES / 1024 / 1024}MB`
  );

type ConvertFieldsInput = {
  email: string;
  filename: string;
  fileSizeBytes: number;
};

export const convertFormFieldsSchema = z
  .object({
    email: convertEmailFieldSchema,
    filename: z.string().min(1, "A file is required").pipe(extensionSchema),
    fileSizeBytes: fileSizeBytesSchema,
  })
  .strict();

/**
 * Returns parsed fields or a Zod error; callers return 400 to the client with safe messages.
 */
export function safeParseConvertFields(
  input: ConvertFieldsInput
):
  | { success: true; data: { email: string; filename: string; fileSizeBytes: number } }
  | { success: false; fieldErrors: Record<string, string[]> } {
  const result = convertFormFieldsSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    fieldErrors: result.error.flatten().fieldErrors as Record<string, string[]>,
  };
}
