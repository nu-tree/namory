import { OAuth2Client } from "google-auth-library";
import { calendar, type calendar_v3 } from "@googleapis/calendar";
import { config } from "../config.js";

// 영구 OAuth2 클라이언트 (lazy 싱글톤). refresh_token 으로 시작하면
// google-auth-library 가 access_token 만료 시 자동 갱신해 준다 — 우리는 신경 X.
// config.google 이 비어있으면(env 미설정) 호출 시 명확히 에러.

let cached: { auth: OAuth2Client; cal: calendar_v3.Calendar } | undefined;

export function getCalendar(): {
  auth: OAuth2Client;
  cal: calendar_v3.Calendar;
} {
  if (cached) return cached;
  if (!config.google) {
    throw new Error(
      "google 캘린더가 비활성 상태입니다 — GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN 셋 다 설정 필요.",
    );
  }
  const auth = new OAuth2Client({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
  });
  auth.setCredentials({ refresh_token: config.google.refreshToken });
  const cal = calendar({ version: "v3", auth });
  cached = { auth, cal };
  return cached;
}

export function isCalendarEnabled(): boolean {
  return !!config.google;
}
