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
  // Basic validations
  if (!apiKey) {
    throw new Error('Missing API key: Please provide your OpenAI API key.');
  }
  if (!file.type.includes('pdf')) {
    throw new Error('Invalid file type: Only PDF files are supported');
  }

  // 1) Upload the actual user PDF file to OpenAI Files API
  const formData = new FormData();
  formData.append('purpose', 'assistants');
  formData.append('file', file); // IMPORTANT: the user's uploaded File object

  let uploadRes: Response;
  try {
    uploadRes = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
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

  const uploaded = await uploadRes.json();
  const fileId: string | undefined = uploaded?.id;
  if (!fileId) {
    throw new Error('File upload failed: missing file id from OpenAI response');
  }

  // 2) Call the Responses API with the file reference and strict JSON output
  // Build prompt content
  const fieldList = fields.map((f) => `- ${f}`).join('\n');
  const instruction = [
    'You are a precise information extraction engine.',
    'Task: Extract the following fields from the attached PDF document.',
    'Rules:',
    '- Return JSON only (no prose).',
    '- Use EXACT keys from the field list.',
    '- If a field is not clearly present, set its value to null.',
    '- Prefer the most explicit value near labels and tables.',
    '- Do not invent data.',
    '- Normalize whitespace.',
    '- Keep units and punctuation from the source where applicable.',
  ].join('\n');

  const userPrompt = `Fields to extract (keys must match exactly):\n${fieldList}\n\nPlease analyze the attached PDF document "${file.name}" and extract the specified fields. Output strictly JSON only.`;

  let resp: Response;
  try {
    resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1', // Using the Responses API as requested
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: `${instruction}\n\n${userPrompt}` },
              { type: 'input_file', file_id: fileId },
            ],
          },
        ],
        // Force pure JSON output
        response_format: { type: 'json_object' },
      }),
    });
  } catch (error) {
    throw new Error(`Network error during extraction: ${(error as Error).message}`);
  }

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Extraction request failed: ${errorText}`);
  }

  const data = await resp.json();

  // Prefer the convenience field if present
  let textOutput: string | undefined = data?.output_text;

  // Fallback: try to assemble text from the structured content if needed
  if (!textOutput && Array.isArray(data?.output)) {
    try {
      const first = data.output[0];
      const blocks = first?.content ?? [];
      textOutput = blocks
        .filter((b: any) => b?.type === 'output_text' || b?.type === 'text')
        .map((b: any) => b?.text ?? b?.content ?? '')
        .join('\n')
        .trim();
    } catch {
      // ignore, we will throw a parse error below if needed
    }
  }

  if (!textOutput || typeof textOutput !== 'string') {
    throw new Error('Invalid document: No textual output received from the model');
  }

  try {
    return JSON.parse(textOutput);
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
