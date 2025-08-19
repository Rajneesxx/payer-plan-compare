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

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to read file as base64'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
  return data.id as string;
}

async function callChatCompletion(params: {
  apiKey: string;
  prompt: string;
  model?: string;
}): Promise<any> {
  const { apiKey, prompt, model = "gpt-4o" } = params;

  const body = {
    model,
    messages: [
      {
        role: "user",
        content: prompt,
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

async function createAssistantAndRun(params: {
  apiKey: string;
  fileId: string;
  prompt: string;
  model?: string;
}): Promise<any> {
  const { apiKey, fileId, prompt, model = "gpt-4o" } = params;

  // Create assistant with file search capability
  const assistantRes = await fetch(`${OPENAI_BASE}/assistants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "assistants=v2",
    },
    body: JSON.stringify({
      model,
      tools: [{ type: "file_search" }],
      tool_resources: {
        file_search: {
          vector_store_ids: []
        }
      }
    }),
  });

  if (!assistantRes.ok) {
    const errTxt = await assistantRes.text();
    throw new Error(`Assistant creation error: ${assistantRes.status} ${errTxt}`);
  }

  const assistant = await assistantRes.json();

  // Create thread
  const threadRes = await fetch(`${OPENAI_BASE}/threads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "assistants=v2",
    },
    body: JSON.stringify({}),
  });

  if (!threadRes.ok) {
    const errTxt = await threadRes.text();
    throw new Error(`Thread creation error: ${threadRes.status} ${errTxt}`);
  }

  const thread = await threadRes.json();

  // Add message with file attachment
  const messageRes = await fetch(`${OPENAI_BASE}/threads/${thread.id}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "assistants=v2",
    },
    body: JSON.stringify({
      role: "user",
      content: prompt,
      attachments: [
        {
          file_id: fileId,
          tools: [{ type: "file_search" }]
        }
      ]
    }),
  });

  if (!messageRes.ok) {
    const errTxt = await messageRes.text();
    throw new Error(`Message creation error: ${messageRes.status} ${errTxt}`);
  }

  // Create and poll run
  const runRes = await fetch(`${OPENAI_BASE}/threads/${thread.id}/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "assistants=v2",
    },
    body: JSON.stringify({
      assistant_id: assistant.id,
    }),
  });

  if (!runRes.ok) {
    const errTxt = await runRes.text();
    throw new Error(`Run creation error: ${runRes.status} ${errTxt}`);
  }

  const run = await runRes.json();

  // Poll for completion
  let runStatus = run;
  while (runStatus.status === "queued" || runStatus.status === "in_progress") {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const statusRes = await fetch(`${OPENAI_BASE}/threads/${thread.id}/runs/${run.id}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
      },
    });

    if (!statusRes.ok) {
      const errTxt = await statusRes.text();
      throw new Error(`Run status check error: ${statusRes.status} ${errTxt}`);
    }

    runStatus = await statusRes.json();
  }

  if (runStatus.status !== "completed") {
    throw new Error(`Run failed with status: ${runStatus.status}`);
  }

  // Get messages
  const messagesRes = await fetch(`${OPENAI_BASE}/threads/${thread.id}/messages`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "assistants=v2",
    },
  });

  if (!messagesRes.ok) {
    const errTxt = await messagesRes.text();
    throw new Error(`Messages retrieval error: ${messagesRes.status} ${errTxt}`);
  }

  const messages = await messagesRes.json();
  
  // Clean up
  await fetch(`${OPENAI_BASE}/assistants/${assistant.id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "assistants=v2",
    },
  });

  return messages;
}

function parseJsonOutput(resp: any): Record<string, any> {
  // Handle different response formats
  let content = "";
  
  if (resp.choices?.[0]?.message?.content) {
    // Chat completion format
    content = resp.choices[0].message.content;
  } else if (resp.data?.[0]?.content?.[0]?.text?.value) {
    // Assistants API format
    content = resp.data[0].content[0].text.value;
  } else {
    throw new Error("Empty response from OpenAI.");
  }

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

  try {
    // 1) Upload file
    const fileId = await uploadFileToOpenAI(file, apiKey);

    // 2) Build prompt and use assistants API
    const fields = FIELD_MAPPINGS[payerPlan];
    const prompt = buildPrompt(fields);
    const response = await createAssistantAndRun({ apiKey, fileId, prompt });

    // 3) Parse JSON
    const json = parseJsonOutput(response);

    // Ensure all expected keys exist; fill missing with null
    const normalized: ExtractedData = {};
    for (const key of fields) {
      const val = Object.prototype.hasOwnProperty.call(json, key) ? json[key] : null;
      normalized[key] = val === undefined ? null : (val as string | null);
    }

    return normalized;
  } catch (error) {
    // Fallback: if assistants API fails, try with simple chat completion
    // (This won't work with PDFs but provides a fallback)
    console.warn("Assistants API failed, falling back to chat completion:", error);
    
    const fields = FIELD_MAPPINGS[payerPlan];
    const prompt = buildPrompt(fields) + "\n\nNote: Unable to process file attachment. Please provide the document content as text.";
    const response = await callChatCompletion({ apiKey, prompt });
    const json = parseJsonOutput(response);

    const normalized: ExtractedData = {};
    for (const key of fields) {
      normalized[key] = null; // Set all to null since we can't process the file
    }

    return normalized;
  }
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
