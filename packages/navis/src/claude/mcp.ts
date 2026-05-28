// Claude Agent SDK에 붙이는 외부 MCP 서버 설정 빌더.
// 도구 화이트리스트는 ./allowed-tools.ts 참조.

// navis가 붙이는 외부 HTTP MCP 서버 설정 형태. 토큰은 Authorization 헤더로 전달.
export interface McpHttpServer {
  type: "http";
  url: string;
  headers: { Authorization: string };
  alwaysLoad: true;
}

// self-host stdio MCP 서버 설정 형태(노션처럼 OAuth 회피용으로 프로세스를 직접 띄움).
export interface McpStdioServer {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

// {url, token} 한 쌍을 HTTP MCP 서버 설정으로 변환. namory 연결과 동일한 패턴.
export function httpMcp(conn: { url: string; token: string }): McpHttpServer {
  return {
    type: "http",
    url: conn.url,
    headers: { Authorization: `Bearer ${conn.token}` },
    alwaysLoad: true,
  };
}

// 노션 self-host MCP를 stdio로 띄우는 설정. 내부 통합 토큰을 NOTION_TOKEN으로 주입하면
// 패키지가 Authorization 헤더 + Notion-Version을 알아서 붙인다. OAuth 없이 정적 토큰만 사용.
export function notionStdio(token: string): McpStdioServer {
  return {
    type: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    env: { NOTION_TOKEN: token },
  };
}
