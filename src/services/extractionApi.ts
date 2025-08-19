export const PAYER_PLANS = {
  QLM: 'QLM',
  ALKOOT: 'ALKOOT'
} as const;

export type PayerPlan = keyof typeof PAYER_PLANS;

export const QLM_FIELDS = [
  "Insured", 
  "Policy No",
  "Period of Insurance", 
  "Plan", 
  "For Eligible Medical Expenses at Al Ahli Hospital",
  "Inpatient Deductible", 
  "Deductible per each outpatient consultation",
  "Vaccination of children", 
  "Psychiatric Treatment", 
  "Dental Copayment",
  "Maternity Copayment", 
  "Optical Copayment"
];

export const ALKOOT_FIELDS = [
  "Policy Number", 
  "Category", 
  "Effective Date",
  "Expiry Date", 
  "Provider-specific co-insurance at Al Ahli Hospital",
  "Co-insurance on all inpatient treatment", 
  "Deductible on consultation",
  "Vaccination & Immunization",
  "Psychiatric treatment & Psychotherapy",
  "Pregnancy & Childbirth", 
  "Dental Benefit", 
  "Optical Benefit"
];

export const FIELD_MAPPINGS = {
  [PAYER_PLANS.QLM]: QLM_FIELDS,
  [PAYER_PLANS.ALKOOT]: ALKOOT_FIELDS
};

export interface ExtractedData {
  [key: string]: string | null;
}

export interface ComparisonResult {
  field: string;
  file1Value: string | null;
  file2Value: string | null;
  status: 'same' | 'different' | 'missing';
}

function buildMessages(fields: string[], fileName: string) {
  const fieldList = fields.map((f) => `- ${f}`).join("\n");
  const system = `You are a precise information extraction engine.\n\nTask: Extract the following fields from the provided PDF document.\nRules:\n- Return JSON only (no prose).\n- Use EXACT keys from the field list.\n- If a field is not clearly present, set its value to null.\n- Prefer the most explicit value near labels and tables.\n- Do not invent data.\n- Normalize whitespace.\n- Keep units and punctuation from the source where applicable.`;
  const user = `Fields to extract (keys must match exactly):\n${fieldList}\n\nPlease analyze the attached PDF document "${fileName}" and extract the specified fields.`;
  return { system, user };
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
  if (!apiKey || !apiKey.startsWith('sk-')) {
    throw new Error('Invalid API key: Please provide a valid OpenAI API key starting with "sk-". You can generate one at https://platform.openai.com/account/api-keys');
  }

  if (!file.type.includes('pdf')) {
    throw new Error('Invalid file type: Only PDF files are supported');
  }

  // Upload file to OpenAI
  const formData = new FormData();
  formData.append("file", file);
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
    throw new Error(`File upload failed: ${errorText}`);
  }

  const uploadedFile = await uploadRes.json();
  const fileId = uploadedFile.id;

  // Get system and user prompts
  const { system, user } = buildMessages(fields, file.name);

  // Create assistant
  let assistantRes;
  try {
    assistantRes = await fetch("https://api.openai.com/v1/assistants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        name: "PDF Extractor",
        instructions: system,
        tools: [{ type: "file_search" }],
      }),
    });
  } catch (error) {
    throw new Error(`Network error during assistant creation: ${(error as Error).message}`);
  }

  if (!assistantRes.ok) {
    const errorText = await assistantRes.text();
    throw new Error(`Assistant creation failed: ${errorText}`);
  }

  const assistant = await assistantRes.json();
  const assistantId = assistant.id;

  // Create thread
  let threadRes;
  try {
    threadRes = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
      },
    });
  } catch (error) {
    throw new Error(`Network error during thread creation: ${(error as Error).message}`);
  }

  if (!threadRes.ok) {
    const errorText = await threadRes.text();
    throw new Error(`Thread creation failed: ${errorText}`);
  }

  const thread = await threadRes.json();
  const threadId = thread.id;

  // Add message to thread with file attachment
  let messageRes;
  try {
    messageRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        role: "user",
        content: user,
        attachments: [
          {
            file_id: fileId,
            tools: [{ type: "file_search" }],
          },
        ],
      }),
    });
  } catch (error) {
    throw new Error(`Network error during message creation: ${(error as Error).message}`);
  }

  if (!messageRes.ok) {
    const errorText = await messageRes.text();
    throw new Error(`Message creation failed: ${errorText}`);
  }

  // Create run
  let runRes;
  try {
    runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        assistant_id: assistantId,
      }),
    });
  } catch (error) {
    throw new Error(`Network error during run creation: ${(error as Error).message}`);
  }

  if (!runRes.ok) {
    const errorText = await runRes.text();
    throw new Error(`Run creation failed: ${errorText}`);
  }

  const run = await runRes.json();
  const runId = run.id;

  // Poll for run completion
  async function pollRunStatus() {
    while (true) {
      let statusRes;
      try {
        statusRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "OpenAI-Beta": "assistants=v2",
          },
        });
      } catch (error) {
        throw new Error(`Network error during run polling: ${(error as Error).message}`);
      }

      if (!statusRes.ok) {
        const errorText = await statusRes.text();
        throw new Error(`Run polling failed: ${errorText}`);
      }

      const statusData = await statusRes.json();
      if (statusData.status === "completed") {
        return;
      }
      if (["failed", "cancelled", "expired"].includes(statusData.status)) {
        throw new Error(`Run failed with status ${statusData.status}: ${statusData.last_error?.message || "Unknown error"}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
    }
  }

  await pollRunStatus();

  // Get messages
  let messagesRes;
  try {
    messagesRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Beta": "assistants=v2",
      },
    });
  } catch (error) {
    throw new Error(`Network error during messages retrieval: ${(error as Error).message}`);
  }

  if (!messagesRes.ok) {
    const errorText = await messagesRes.text();
    throw new Error(`Messages retrieval failed: ${errorText}`);
  }

  const messagesData = await messagesRes.json();
  const assistantMessage = messagesData.data[0]; // Latest message
  let content = "{}";
  if (assistantMessage && assistantMessage.role === "assistant" && assistantMessage.content[0]?.text?.value) {
    content = assistantMessage.content[0].text.value;
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Invalid document: Failed to parse extracted data from PDF');
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
  // Validate file type early
  if (!file.type.includes('pdf')) {
    throw new Error('Invalid file type: Only PDF files are supported');
  }

  const fields = FIELD_MAPPINGS[payerPlan];
  if (!fields) {
    throw new Error(`Invalid payer plan: ${payerPlan}`);
  }

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
  if (!file1.type.includes('pdf') || !file2.type.includes('pdf')) {
    throw new Error('Invalid file type: Both files must be PDFs');
  }

  try {
    const [data1, data2] = await Promise.all([
      extractDataApi({ file: file1, payerPlan, apiKey }),
      extractDataApi({ file: file2, payerPlan, apiKey }),
    ]);

    const fields = FIELD_MAPPINGS[payerPlan];
    if (!fields) {
      throw new Error(`Invalid payer plan: ${payerPlan}`);
    }

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
