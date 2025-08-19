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
  form.append("purpose", "vision");
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
  return data.id as string;
}

async function callChatCompletionWithFile(params: {
  apiKey: string;
  fileId: string;
  prompt: string;
  model?: string;
}): Promise<any> {
  const { apiKey, fileId, prompt, model = "gpt-4o" } = params;

  const body = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:application/pdf;base64,${fileId}`, // This approach won't work directly
              detail: "high"
            }
          }
        ],
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 1500,
  };

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`OpenAI chat completion error: ${res.status} ${errTxt}`);
  }

  const json = await res.json();
  return json;
}

// Alternative approach using direct file content
async function callChatCompletionWithFileContent(params: {
  apiKey: string;
  file: File;
  prompt: string;
  model?: string;
}): Promise<any> {
  const { apiKey, file, prompt, model = "gpt-4o" } = params;

  // Convert file to base64
  const fileBuffer = await file.arrayBuffer();
  const base64File = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));

  const body = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:${file.type};base64,${base64File}`,
              detail: "high"
            }
          }
        ],
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 1500,
  };

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`OpenAI chat completion error: ${res.status} ${errTxt}`);
  }

  const json = await res.json();
  return json;
}

function parseJsonOutput(resp: any): Record<string, any> {
  // Extract content from the standard chat completion response
  const content = resp.choices?.[0]?.message?.content;
  
  if (!content) throw new Error("Empty response from OpenAI.");

  try {
    return JSON.parse(content);
  } catch {
    // Try to extract a JSON block from the text
    const match = content.match(/\{[\s\S]*\}/);
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

  // Build prompt and call chat completion with file content
  const fields = FIELD_MAPPINGS[payerPlan];
  const prompt = buildPrompt(fields);
  
  // Use direct file content approach since PDF processing with vision models
  // requires the file to be converted to images or use a different approach
  const response = await callChatCompletionWithFileContent({ 
    apiKey, 
    file, 
    prompt 
  });

  // Parse JSON
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
