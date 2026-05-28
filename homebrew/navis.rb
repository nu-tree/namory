# Homebrew Formula for navis CLI.
#
# 이 파일을 별도 tap 레포(예: nu-tree/homebrew-navis)의
# Formula/navis.rb 로 복사해 두면, 사용자는 다음 두 줄로 설치 가능:
#
#   brew tap nu-tree/navis
#   brew install navis
#
# 새 버전 릴리스 시: 메인 레포에서 git tag vX.Y.Z push → 아래 url/sha256만 갱신.
class Navis < Formula
  desc "Personal Claude-powered REPL (Discord/CLI bridge with namory memory)"
  homepage "https://github.com/nu-tree/navis"
  url "https://github.com/nu-tree/navis/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "PLACEHOLDER_RUN_shasum_-a_256_AFTER_TAGGING"
  license "MIT"
  head "https://github.com/nu-tree/navis.git", branch: "main"

  depends_on "node"

  def install
    # 모노레포 내 packages/navis 만 빌드. pnpm-lock 은 루트에 있지만 npm 으로 단독 설치
    # 가능(workspace-internal 의존성 없음). --no-package-lock 으로 pnpm 락과 충돌 회피.
    cd "packages/navis" do
      system "npm", "install", "--no-package-lock", "--include=dev"
      system "npm", "run", "build"
      system "npm", "prune", "--omit=dev"   # 런타임 의존성만 남김(이미지 슬림화)
      libexec.install "dist", "node_modules", "package.json"
    end

    # 진입 래퍼: brew node 의 절대경로로 dist/bin.js 실행.
    (bin/"navis").write <<~SCRIPT
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/dist/bin.js" "$@"
    SCRIPT
    (bin/"navis").chmod 0755
  end

  def caveats
    <<~EOS
      navis 는 본인 토큰이 있어야 동작합니다. 설치 후 한 번만 설정:

        mkdir -p ~/.config/navis
        cat > ~/.config/navis/env <<EOF
        CLAUDE_CODE_OAUTH_TOKEN=...
        NAMORY_MCP_URL=https://<your-namory-host>/mcp
        NAMORY_TOKEN=...
        SYSTEM_PROMPT=\\\`당신은 사용자 전용 비서 '나비스'입니다 ...\\\`

        # 디스코드 모드도 같이 쓸 거면 추가:
        DISCORD_TOKEN=...
        ALLOWED_USER_IDS=...

        # 선택(노션/구글 등)도 같은 파일에.
        EOF

      그 다음:  navis   ← 어디서든 실행. 현재 디렉터리에서 프로젝트 자동 감지.
    EOS
  end

  test do
    # 토큰 없이 띄우면 config 검증이 즉시 "필수 환경변수 누락" 메시지로 종료해야 함 —
    # 그 메시지가 보이면 진입 스크립트 + Node + dist 가 모두 정상 동작한다는 뜻.
    output = shell_output("#{bin}/navis 2>&1", 1)
    assert_match "필수 환경변수 누락", output
  end
end
