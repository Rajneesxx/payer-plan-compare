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

  // Build a concise, strict instruction for JSON-only extraction
  const prompt = `You are a precise information extraction engine.

Task: Extract ONLY the following fields from the attached PDF document.
Rules:
- Output STRICT JSON only (no prose or explanations)
- Keys must match exactly as listed below
- If a field is not clearly present in the PDF, use null
- Do not invent data
- Preserve units/punctuation when present
- Analyze the entire PDF document carefully

Fields to extract (keys must match exactly):
${fieldList}

The attached file is a PDF document. Please analyze it and return the extracted data as JSON.`;

  // Use the correct content type for PDF document
  const input = [
    {
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        {
          type: "input_file",
          document: {
            data: base64Data,
            mime_type: file.type
          }
        },
      ],
    },
  ];

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "o3",
      input,
      temperature: 0,
      text: { format: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    // Surface a clearer error when the API rejects the MIME type
    if (/mime|mimetype|image_url|unsupported/i.test(errText)) {
      throw new Error(
        "OpenAI rejected the file format. Ensure you're uploading a valid PDF and your model supports PDF inputs."
      );
    }
    throw new Error(errText || "OpenAI request failed");
  }

  const data = await res.json();

  // Try multiple shapes (Responses API and fallback to Chat Completions-like)
  let content = "{}";
  // Responses API common shapes
  if (Array.isArray(data?.output_text) && data.output_text.length > 0) {
    content = data.output_text[0];
  } else if (typeof data?.output_text === "string") {
    content = data.output_text;
  } else if (Array.isArray(data?.content)) {
    const textPart = data.content.find((c: any) => c.type === "output_text" || c.type === "text");
    if (textPart?.text) content = textPart.text;
  } else if (Array.isArray(data?.output)) {
    const textPart = data.output?.[0]?.content?.find((c: any) => c.type === "output_text" || c.type === "text");
    if (textPart?.text) content = textPart.text;
  } else if (data?.choices?.[0]?.message?.content) {
    // Fallback to chat.completions shape
    content = data.choices[0].message.content;
  }

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
