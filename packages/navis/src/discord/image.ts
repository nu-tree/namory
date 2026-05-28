import sharp from "sharp";
import type { Message } from "discord.js";
import type { InputImage } from "../claude/types.js";

// Anthropic이 받는 이미지 타입. 그 외 첨부(pdf 등)는 무시한다.
const ALLOWED_IMAGE_TYPES = new Set<InputImage["mediaType"]>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
// 이미지당 상한(바이트). API 제한(~5MB) 안쪽으로 잡아 호출 실패를 막는다.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// 긴 변 상한(px). 휴대폰 스크린샷처럼 큰 이미지는 Claude가 거부("dimensions exceed
// 2000x2000px")하므로 보내기 전에 비율 유지로 축소한다. 1568은 Anthropic 권장
// 다운스케일 기준 — 이 이하면 추가 리사이즈 없이 토큰/비용도 최소.
const MAX_IMAGE_EDGE = 1568;

// 큰 이미지를 긴 변 MAX_IMAGE_EDGE 이하로 축소(원본이 작으면 그대로). gif는 sharp가
// 정적 프레임으로 다루므로 png로 변환한다. 실패 시 원본 base64로 폴백.
async function downscale(
  buf: Buffer,
  mediaType: InputImage["mediaType"],
): Promise<InputImage> {
  try {
    const img = sharp(buf);
    const meta = await img.metadata();
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longEdge <= MAX_IMAGE_EDGE) {
      return { mediaType, data: buf.toString("base64") };
    }
    const resized = img.resize(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    });
    // 원본 포맷 유지(gif → png). 재인코딩으로 용량도 함께 줄어든다.
    const { out, type } =
      mediaType === "image/png"
        ? { out: resized.png(), type: "image/png" as const }
        : mediaType === "image/webp"
          ? { out: resized.webp(), type: "image/webp" as const }
          : mediaType === "image/gif"
            ? { out: resized.png(), type: "image/png" as const }
            : { out: resized.jpeg({ quality: 85 }), type: "image/jpeg" as const };
    const data = (await out.toBuffer()).toString("base64");
    return { mediaType: type, data };
  } catch (err) {
    console.error("[discord] 이미지 리사이즈 실패, 원본 사용:", err);
    return { mediaType, data: buf.toString("base64") };
  }
}

// 메시지의 첨부 중 이미지를 내려받아 base64로 만든다. 타입·용량 안 맞으면 건너뛴다.
// 큰 이미지는 Claude 한도에 맞게 축소한 뒤 싣는다.
export async function collectImages(message: Message): Promise<InputImage[]> {
  const images: InputImage[] = [];
  for (const att of message.attachments.values()) {
    const ct = att.contentType?.split(";")[0]?.trim() as
      | InputImage["mediaType"]
      | undefined;
    if (!ct || !ALLOWED_IMAGE_TYPES.has(ct)) continue;
    if (att.size > MAX_IMAGE_BYTES) {
      console.warn(`[discord] 이미지 용량 초과로 건너뜀: ${att.size}B`);
      continue;
    }
    try {
      const res = await fetch(att.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      images.push(await downscale(buf, ct));
    } catch (err) {
      console.error("[discord] 이미지 다운로드 실패:", err);
    }
  }
  return images;
}
