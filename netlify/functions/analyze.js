const MODEL = process.env.OPENAI_MODEL || "gpt-5.5";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["profileSummary", "positiveSignals", "negativeSignals", "recommendations", "aiSignals"],
  properties: {
    profileSummary: { type: "string" },
    positiveSignals: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "weight", "evidence"],
        properties: {
          name: { type: "string" },
          weight: { type: "number" },
          evidence: { type: "string" },
        },
      },
    },
    negativeSignals: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "weight", "evidence"],
        properties: {
          name: { type: "string" },
          weight: { type: "number" },
          evidence: { type: "string" },
        },
      },
    },
    recommendations: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "reason", "watchOut"],
        properties: {
          id: { type: "string" },
          reason: { type: "string" },
          watchOut: { type: "string" },
        },
      },
    },
    aiSignals: {
      type: "array",
      maxItems: 20,
      items: { type: "string" },
    },
  },
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Only POST is supported." });

  const expectedCode = process.env.APP_ACCESS_CODE;
  const providedCode = event.headers["x-app-access-code"] || event.headers["X-App-Access-Code"];
  if (expectedCode && providedCode !== expectedCode) return json(401, { error: "访问码不正确。" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(500, { error: "OPENAI_API_KEY is not configured." });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const items = Array.isArray(body.items) ? body.items.slice(0, 80) : [];
  if (!items.length) return json(400, { error: "缺少内容列表。" });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      reasoning: { effort: "low" },
      instructions: [
        "你是一个私人内容 taste 分析器，帮助用户摆脱平台算法主页。",
        "任务：根据用户保存的具体内容、感兴趣/不感兴趣评价、原因、摘要、字幕片段，提炼用户的偏好边界。",
        "必须保持克制、具体、可解释。不要写励志长文，不要编造平台没有提供的信息。",
        "推荐理由要说明为什么这条内容适合现在进入个人主页。",
        "watchOut 要说明可能不适合的原因，例如太容易被平台带走、信息密度低、情绪消耗、与反感信号接近。",
        "所有输出使用中文。每条 recommendation 的 id 必须来自输入 items。",
      ].join("\n"),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(
                {
                  profile: body.profile || {},
                  items,
                },
                null,
                2,
              ),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "guiliu_taste_analysis",
          schema,
          strict: true,
        },
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return json(response.status, { error: data.error?.message || "OpenAI request failed." });
  }

  const outputText = extractOutputText(data);
  if (!outputText) return json(502, { error: "AI 没有返回可解析内容。" });

  try {
    return json(200, JSON.parse(outputText));
  } catch {
    return json(502, { error: "AI 返回内容不是有效 JSON。" });
  }
};

function extractOutputText(data) {
  if (data.output_text) return data.output_text;
  const content = data.output?.flatMap((item) => item.content || []) || [];
  const textItem = content.find((item) => item.type === "output_text" && item.text);
  return textItem?.text || "";
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Access-Code",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: statusCode === 204 ? "" : JSON.stringify(body),
  };
}
