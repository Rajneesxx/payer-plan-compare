import { FIELD_MAPPINGS, type PayerPlan, type ExtractedData, type ComparisonResult } from "@/constants/fields";

function buildMessages(fields: string[], fileName: string) {
  const fieldList = fields.map((f) => `- ${f}`).join("\n");
  const system = `You are a precise information extraction engine.\n\nTask: Extract the following fields from the provided PDF document.\nRules:\n- Return JSON only (no prose).\n- Use EXACT keys from the field list.\n- If a field is not clearly present, set its value to null.\n- Prefer the most explicit value near labels and tables.\n- Do not invent data.\n- Normalize whitespace.\n- Keep units and punctuation from the source where applicable.`;
  const user = `Fields to extract (keys must match exactly):\n${fieldList}\n\nPlease analyze the attached PDF document "${fileName}" and extract the specified fields.`;
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  return messages;
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
  const base64Data = await fileToBase64(file);
  const fieldList = fields.map((f) => `- ${f}`).join("\n");
  
  const messages = [
    {
      role: "system" as const,
      content: `You are a precise information extraction engine.\n\nTask: Extract the following fields from the provided PDF document.\nRules:\n- Return JSON only (no prose).\n- Use EXACT keys from the field list.\n- If a field is not clearly present, set its value to null.\n- Prefer the most explicit value near labels and tables.\n- Do not invent data.\n- Normalize whitespace.\n- Keep units and punctuation from the source where applicable.`
    },
    {
      role: "user" as const,
      content: [
        {
          type: "text",
          text: `Fields to extract (keys must match exactly):\n${fieldList}\n\nPlease analyze the attached PDF document and extract the specified fields.`
        },
        {
          type: "image_url",
          image_url: {
            url: `data:application/pdf;base64,${base64Data}`
          }
        }
      ]
    }
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || "OpenAI request failed");
  }

  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    // Fallback: attempt to extract JSON block
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // ignore
      }
    }
    return {} as Record<string, unknown>;
  }
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
    reader.onerror = error => reject(error);
  });
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
  // 1) Get the fields for this payer plan
  const fields = FIELD_MAPPINGS[payerPlan];

  // 2) Call OpenAI with the PDF file directly
  const raw = await callOpenAIWithPDF({ apiKey, file, fields });

  // 3) Normalize to our ExtractedData shape with all expected keys
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
  // Run two extractions in parallel for efficiency
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
}
