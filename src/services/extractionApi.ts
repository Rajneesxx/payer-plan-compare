async function callOpenAIWithPDF({
  apiKey,
  file,
  fields,
}: {
  apiKey: string;
  file: File;
  fields: string[];
}): Promise<Record<string, unknown>> {
  if (!file.type.includes('pdf')) {
    throw new Error('Invalid file type: Only PDF files are supported');
  }

  // Upload file to OpenAI
  const formData = new FormData();
  formData.append("file", file);
  formData.append("purpose", "assistants"); // Changed to a valid purpose

  const uploadRes = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    throw new Error(`File upload failed: ${await uploadRes.text()}`);
  }

  const uploadedFile = await uploadRes.json();
  const fileId = uploadedFile.id;

  const fieldList = fields.map((f) => `- ${f}`).join("\n");

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
${fieldList}`;

  // Corrected endpoint to /v1/chat/completions (assuming Assistants API usage)
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "o3", // Ensure this model supports file processing
      messages: [
        {
          role: "user",
          content: prompt,
          attachments: [{ id: fileId, mime_type: "application/pdf" }], // Attach file ID
        },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();

  let content = "{}";
  if (data?.choices?.[0]?.message?.content) {
    content = data.choices[0].message.content;
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Invalid document: Failed to parse extracted data from PDF');
  }
}

// Rest of the functions (extractDataApi, compareDataApi) remain unchanged

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
