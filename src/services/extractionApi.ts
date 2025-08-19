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
  // Validate file type
  if (!file.type.includes('pdf')) {
    throw new Error('Invalid file type: Only PDF files are supported');
  }

  // Basic file integrity check
  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error('Invalid document: The PDF file is empty.');
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

  // Construct messages using buildMessages
  const messages = buildMessages(fields, file.name);

  // Call OpenAI API with file attachment
  let res;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o", // Using gpt-4o for robust PDF text and OCR capabilities
        messages: [
          ...messages,
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze the attached PDF document with file ID ${fileId} and extract the specified fields. If the PDF is unreadable or corrupted, return an empty JSON object {}.`,
              },
              {
                type: "document",
                document: {
                  file_id: fileId,
                  mime_type: "application/pdf",
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" }, // Enforce JSON output
        max_tokens: 1500, // Increased to handle complex PDFs
      }),
    });
  } catch (error) {
    throw new Error(`Network error during chat completion: ${(error as Error).message}`);
  }

  if (!res.ok) {
    const errorText = await res.text();
    if (/mime|mimetype|image_url|unsupported/i.test(errorText)) {
      throw new Error('Invalid file type: OpenAI rejected the file format. Only PDF files are supported');
    }
    if (/invalid|corrupt|document/i.test(errorText)) {
      throw new Error('Invalid document: The PDF file appears to be corrupted or unreadable');
    }
    throw new Error(`Chat completion failed: ${errorText}`);
  }

  const data = await res.json();

  let content = "{}";
  if (data?.choices?.[0]?.message?.content) {
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
