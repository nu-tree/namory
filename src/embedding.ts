const MODEL = "voyage-3-large";
const ENDPOINT = "https://api.voyageai.com/v1/embeddings";

// Voyage 임베딩 (1024차원). 별도 SDK 의존성 없이 fetch로 최소 구현.
// input_type 은 검색 정확도를 위해 저장=document / 질의=query 로 구분.
export async function embed(
  input: string,
  inputType: "document" | "query",
): Promise<number[]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY 환경변수가 필요합니다");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input,
      input_type: inputType,
      output_dimension: 1024,
    }),
  });

  if (!res.ok) {
    throw new Error(`Voyage 임베딩 실패: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}
