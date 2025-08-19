// OpenAI extraction service using Responses API with attachments + file_search
// Minimal public surface retained: extractDataApi and compareDataApi

import { FIELD_MAPPINGS, type PayerPlan, type ExtractedData, type ComparisonResult } from "@/constants/fields";

const OPENAI_BASE = "https://api.openai.com/v1";

function assertKey(apiKey?: string) {
  if (!apiKey) throw new Error("Missing OpenAI API key");
}

function buildPrompt(fields: string[]): string {
  const fieldList = fields.map((f) => `- ${f}`).join("\n");
  return (
    "You are a precise information extraction engine capable of processing PDF documents, including scanned PDFs with OCR.\n" +
    "Task: Extract the following fields from the attached PDF document.\n" +
    "Rules:\n" +
    "- Return JSON only (no prose or explanations).\n" +
    "- Use EXACT keys from the field list below.\n" +
    "- If a field is not clearly present in the document, set its value to null.\n" +
    "- Prefer the most explicit value near labels, tables, or key-value pairs.\n" +
    "- Do not invent data.\n" +
    "- Normalize whitespace and remove unnecessary line breaks.\n" +
    "- Preserve units, punctuation, and formatting from the source where applicable.\n\n" +
    "Fields to extract (keys must match exactly):\n" +
    `${fieldList}\n\n` +
    "Analyze the attached PDF and output strictly JSON only."
  );
}

async function uploadFileToOpenAI(file: File, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append("purpose", "assistants");
  form.append("file", file, file.name);

  const res = await fetch(`${OPENAI_BASE}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI file upload failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  // Return file id
  return data.id as string;
}

async function callResponsesWithAttachment(params: {
  apiKey: string;
  fileId: string;
  prompt: string;
  model?: string;
}): Promise<any> {
  const { apiKey, fileId, prompt, model = "gpt-4.1" } = params;

  const body = {
    model,
    // Single message with the prompt
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    // Attach the uploaded file for file_search tool
    attachments: [
      {
        file_id: fileId,
        tools: [{ type: "file_search" }],
      },
    ],
    tools: [{ type: "file_search" }],
    text: { format: "json" },
    temperature: 0,
    max_output_tokens: 1500,
  } as const;

  const res = await fetch(`${OPENAI_BASE}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "assistants=v2",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`OpenAI responses error: ${res.status} ${errTxt}`);
  }

  const json = await res.json();
  return json;
}

function parseJsonOutput(resp: any): Record<string, any> {
  // Prefer output_text convenience field if present
  const raw = typeof resp.output_text === "string" && resp.output_text.trim()
    ? resp.output_text
    : Array.isArray(resp.output)
      ? resp.output
          .map((p: any) => (typeof p?.content?.[0]?.text === "string" ? p.content[0].text : ""))
          .join("")
      : "";

  if (!raw) throw new Error("Empty response from OpenAI.");

  try {
    return JSON.parse(raw);
  } catch {
    // Try to extract a JSON block from the text
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("Model did not return valid JSON.");
  }
}

export async function extractDataApi({
  file,
  payerPlan,
  apiKey,
}: {
  file: File;
  payerPlan: PayerPlan;
  apiKey: string;
}): Promise<ExtractedData> {
  assertKey(apiKey);

  // 1) Upload file
  const fileId = await uploadFileToOpenAI(file, apiKey);

  // 2) Build prompt and call responses
  const fields = FIELD_MAPPINGS[payerPlan];
  const prompt = buildPrompt(fields);
  const response = await callResponsesWithAttachment({ apiKey, fileId, prompt });

  // 3) Parse JSON
  const json = parseJsonOutput(response);

  // Ensure all expected keys exist; fill missing with null
  const normalized: ExtractedData = {};
  for (const key of fields) {
    const val = Object.prototype.hasOwnProperty.call(json, key) ? json[key] : null;
    normalized[key] = val === undefined ? null : (val as string | null);
  }

  return normalized;
}

export async function compareDataApi({
  file1,
  file2,
  payerPlan,
  apiKey,
}: {
  file1: File;
  file2: File;
  payerPlan: PayerPlan;
  apiKey: string;
}): Promise<ComparisonResult[]> {
  // Extract both in parallel
  const [data1, data2] = await Promise.all([
    extractDataApi({ file: file1, payerPlan, apiKey }),
    extractDataApi({ file: file2, payerPlan, apiKey }),
  ]);

  const fields = FIELD_MAPPINGS[payerPlan];
  const results: ComparisonResult[] = fields.map((field) => {
    const v1 = (data1 as any)[field] ?? null;
    const v2 = (data2 as any)[field] ?? null;

    let status: ComparisonResult["status"] = "same";
    if (v1 === null && v2 === null) status = "missing";
    else if (v1 !== v2) status = "different";

    return { field, file1Value: v1, file2Value: v2, status };
  });

  return results;
}
