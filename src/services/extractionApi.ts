import { FIELD_MAPPINGS, type PayerPlan, type ExtractedData, type ComparisonResult } from "@/constants/fields";

function buildMessages(fields: string[], fileName: string) {
  const fieldList = fields.map((f) => `- ${f}`).join("\n");
  const system = `You are a precise information extraction engine capable of processing PDF documents, including text-based and scanned PDFs with OCR.

Task: Extract the following fields from the provided PDF document.
Rules:
- Return JSON only (no prose or explanations).
- Use EXACT keys from the field list below.
- If a field is not clearly present in the document, set its value to null.
- Prefer the most explicit value near labels, tables, or key-value pairs.
- Do not invent data.
- Normalize whitespace and remove unnecessary line breaks.
- Preserve units, punctuation, and formatting from the source where applicable.
- If the PDF is scanned, use OCR to extract text accurately.
- Search the entire document, including headers, footers, and tables.
- If the document is unreadable or corrupted, return an empty JSON object {}.`;
  const user = `Fields to extract (keys must match exactly):\n${fieldList}\n\nPlease analyze the attached PDF document "${fileName}" and extract the specified fields.`;
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  return messages;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(new Error(`Failed to read file: ${error}`));
  });
}

async function callOpenAIWithPDF({
  apiKey,
  file,
  fields,
}: {
  apiKey: string;
  file: File;
  fields: string[];
}): Promise<Record<string, unknown>> {
  // Validate file type (accept content-type or .pdf extension)
  const isPdfLike = file.type.toLowerCase().includes('pdf') || /\.pdf$/i.test(file.name);
  if (!isPdfLike) {
    throw new Error('Invalid file type: Only PDF files are supported');
  }

  // Basic file integrity and size check
  const arrayBuffer = await file.arrayBuffer();
  // Quick magic header check: PDFs begin with %PDF
  const bytes = new Uint8Array(arrayBuffer.slice(0, 4));
  const header = String.fromCharCode(...bytes);
  if (header !== '%PDF') {
    // Not fatal for some generators, but helps catch renamed files
    console.warn('File header is not %PDF; proceeding but may fail downstream');
  }
  if (arrayBuffer.byteLength === 0) {
    throw new Error('Invalid document: The PDF file is empty.');
  }
  if (file.size > 100 * 1024 * 1024) { // 100 MB limit
    throw new Error('Invalid document: File size exceeds 100 MB limit.');
  }

  // Upload file to OpenAI
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("purpose", "assistants");

  let uploadRes;
  try {
    uploadRes = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
  } catch (error) {
    throw new Error(`Network error during file upload: ${(error as Error).message}`);
  }

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    console.log("Upload Error Details:", errorText); // Debug log
    if (/size|limit|exceeded/i.test(errorText)) {
      throw new Error('Invalid document: File size exceeds OpenAI limits.');
    }
    if (/unsupported|mime|format/i.test(errorText)) {
      throw new Error('Invalid file format: OpenAI does not support this PDF format.');
    }
    if (/corrupt|invalid|document/i.test(errorText)) {
      throw new Error('Invalid document: The PDF file appears to be corrupted or unreadable.');
    }
    throw new Error(`File upload failed: ${errorText}`);
  }

  const uploadedFile = await uploadRes.json();
  const fileId = uploadedFile.id;

  // Construct messages using buildMessages
  const messages = buildMessages(fields, file.name);

  // Call OpenAI API using Responses API with file_search tool
  // Build a single user prompt string from the system + user messages
  const combinedPrompt = `${messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n")}\n\nAnalyze the attached PDF document and extract the specified fields. If the PDF is unreadable or corrupted, return an empty JSON object {}.`;

  let res;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: combinedPrompt,
        attachments: [
          { file_id: fileId, tools: [{ type: "file_search" }] },
        ],
        tools: [{ type: "file_search" }],
        response_format: { type: "json_object" },
        temperature: 0,
        max_output_tokens: 1500,
      }),
    });
  } catch (error) {
    throw new Error(`Network error during PDF processing: ${(error as Error).message}`);
  }

  if (!res.ok) {
    const errorText = await res.text();
    console.log("Responses API Error Details:", errorText);
    if (/file_search|attachment|tool|responses|chat\.completions|content\s*type/i.test(errorText)) {
      // Fallback to Assistants v2 flow when Responses+attachments is rejected
      const fallbackContent = await runAssistantsV2Fallback({ apiKey, fileId, prompt: combinedPrompt });
      return JSON.parse(fallbackContent);
    }
    if (/size|limit|exceed/i.test(errorText)) {
      throw new Error('Invalid document: File size exceeds OpenAI limits.');
    }
    if (/unsupported|mime|mimetype|format/i.test(errorText)) {
      throw new Error('Invalid file format: The uploaded file is not a valid PDF.');
    }
    throw new Error(`OpenAI PDF processing failed: ${errorText}`);
  }

  const data = await res.json();

  // Try multiple shapes as OpenAI Responses API evolves
  let content = "{}";
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    content = data.output_text;
  } else if (data?.output?.[0]?.content?.[0]?.text?.value) {
    content = data.output[0].content[0].text.value;
  } else if (data?.output?.[0]?.content?.[0]?.text) {
    content = data.output[0].content[0].text;
  } else if (data?.choices?.[0]?.message?.content) {
    // Fallback if API returns chat-completions-like shape
    content = data.choices[0].message.content;
  }

  try {
    const parsed = JSON.parse(content);
    // Validate that the response is meaningful
    if (Object.keys(parsed).length === 0) {
      throw new Error('Invalid document: The PDF file appears to be corrupted or unreadable.');
    }
    // Check if any requested fields are present
    if (!Object.keys(parsed).some(key => fields.includes(key))) {
      throw new Error('No requested fields found in the document. The PDF may not contain the expected data.');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid document: Failed to parse extracted data from PDF: ${(error as Error).message}`);
  }
}

async function runAssistantsV2Fallback({
  apiKey,
  fileId,
  prompt,
}: {
  apiKey: string;
  fileId: string;
  prompt: string;
}): Promise<string> {
  const baseHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'OpenAI-Beta': 'assistants=v2',
  } as const;

  // 1) Create a vector store
  const vsRes = await fetch('https://api.openai.com/v1/vector_stores', {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ name: 'pdf-vs-temp' }),
  });
  if (!vsRes.ok) {
    const t = await vsRes.text();
    throw new Error(`OpenAI vector store error: ${t}`);
  }
  const vectorStore = await vsRes.json();
  const vectorStoreId = vectorStore.id;

  // 2) Attach file to vector store
  const vsFileRes = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!vsFileRes.ok) {
    const t = await vsFileRes.text();
    throw new Error(`OpenAI vector store file error: ${t}`);
  }

  // 3) Create assistant configured with file_search
  const asstRes = await fetch('https://api.openai.com/v1/assistants', {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      model: 'gpt-4o',
      tools: [{ type: 'file_search' }],
      tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } },
      instructions: 'Return JSON only.'
    }),
  });
  if (!asstRes.ok) {
    const t = await asstRes.text();
    throw new Error(`OpenAI assistant create error: ${t}`);
  }
  const assistant = await asstRes.json();
  const assistantId = assistant.id;

  // 4) Create a thread with the prompt
  const threadRes = await fetch('https://api.openai.com/v1/threads', {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      messages: [
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!threadRes.ok) {
    const t = await threadRes.text();
    throw new Error(`OpenAI thread create error: ${t}`);
  }
  const thread = await threadRes.json();
  const threadId = thread.id;

  // 5) Create a run
  const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ assistant_id: assistantId }),
  });
  if (!runRes.ok) {
    const t = await runRes.text();
    throw new Error(`OpenAI run create error: ${t}`);
  }
  const run = await runRes.json();
  const runId = run.id;

  // 6) Poll run status
  const deadline = Date.now() + 60_000; // 60s
  while (true) {
    const getRun = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
      headers: baseHeaders,
    });
    if (!getRun.ok) {
      const t = await getRun.text();
      throw new Error(`OpenAI run status error: ${t}`);
    }
    const runStatus = await getRun.json();
    if (runStatus.status === 'completed') break;
    if (runStatus.status === 'failed' || runStatus.status === 'expired' || runStatus.status === 'cancelled') {
      throw new Error(`OpenAI run failed: ${JSON.stringify(runStatus)}`);
    }
    if (Date.now() > deadline) {
      throw new Error('OpenAI run timed out.');
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  // 7) Fetch assistant messages and return the latest assistant text content
  const msgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages?order=desc&limit=5`, {
    headers: baseHeaders,
  });
  if (!msgRes.ok) {
    const t = await msgRes.text();
    throw new Error(`OpenAI messages fetch error: ${t}`);
  }
  const msgList = await msgRes.json();
  const firstAssistant = (msgList.data || []).find((m: any) => m.role === 'assistant');
  if (!firstAssistant) {
    throw new Error('No assistant message returned.');
  }
  // Concatenate text parts
  let out = '';
  for (const block of firstAssistant.content || []) {
    if (block.type === 'text') {
      const v = block.text?.value ?? '';
      out += v;
    }
  }
  return out || '{}';
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
  // Validate file type early
  const isPdfLike = file.type.toLowerCase().includes('pdf') || /\.pdf$/i.test(file.name);
  if (!isPdfLike) {
    throw new Error('Invalid file type: Only PDF files are supported');
  }

  const fields = FIELD_MAPPINGS[payerPlan];
  let raw: Record<string, unknown>;
  try {
    raw = await callOpenAIWithPDF({ apiKey, file, fields });
  } catch (error) {
    throw error; // Propagate specific errors from callOpenAIWithPDF
  }

  const result: ExtractedData = {};
  for (const key of fields) {
    const val = (raw as any)[key];
    result[key] = val == null || val === "" ? null : String(val);
  }
  return result;
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
  // Validate file types early
  const isPdf1 = file1.type.toLowerCase().includes('pdf') || /\.pdf$/i.test(file1.name);
  const isPdf2 = file2.type.toLowerCase().includes('pdf') || /\.pdf$/i.test(file2.name);
  if (!isPdf1 || !isPdf2) {
    throw new Error('Invalid file type: Both files must be PDFs');
  }

  try {
    const [data1, data2] = await Promise.all([
      extractDataApi({ file: file1, payerPlan, apiKey }),
      extractDataApi({ file: file2, payerPlan, apiKey }),
    ]);

    const fields = FIELD_MAPPINGS[payerPlan];
    const results: ComparisonResult[] = fields.map((field) => {
      const v1 = data1[field];
      const v2 = data2[field];

      let status: ComparisonResult["status"] = "different";
      if (v1 == null || v2 == null) status = "missing";
      else if (String(v1).trim() === String(v2).trim()) status = "same";

      return {
        field,
        file1Value: v1,
        file2Value: v2,
        status,
      };
    });

    return results;
  } catch (error) {
    throw error; // Propagate specific errors from extractDataApi
  }
}
