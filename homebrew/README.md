# navis Homebrew 배포 가이드

navis CLI 를 `brew install navis` 한 줄로 받아 쓸 수 있게 만드는 셋업 절차.
한 번만 만들어두면 이후엔 메인 레포에 새 git tag 만 찍고 Formula 한 줄 갱신.

## 구조 — 레포 2개

| 레포 | 역할 |
|---|---|
| `nu-tree/namory` (현재 모노레포) | navis 소스 코드 |
| `nu-tree/homebrew-navis` (신규) | Formula 파일만 |

> tap 레포명은 반드시 `homebrew-` 로 시작해야 `brew tap` 명령이 찾는다.

## 1회 셋업

### 1) tap 레포 생성

GitHub 에서 `nu-tree/homebrew-navis` public 레포 생성. 안에 디렉터리 구조:

```
homebrew-navis/
└── Formula/
    └── navis.rb
```

### 2) Formula 복사

이 디렉터리(`homebrew/navis.rb`)를 위 `Formula/navis.rb` 로 복사.

### 3) 첫 릴리스 태그 (메인 레포)

```bash
# 이 모노레포에서
git tag v0.1.0
git push origin v0.1.0
```

GitHub 가 자동으로 타르볼을 생성:
`https://github.com/nu-tree/namory/archive/refs/tags/v0.1.0.tar.gz`

### 4) Formula 의 sha256 채우기

```bash
curl -sL https://github.com/nu-tree/namory/archive/refs/tags/v0.1.0.tar.gz | shasum -a 256
# 출력된 해시를 Formula/navis.rb 의 sha256 자리에 붙여넣기
```

tap 레포에 커밋 + push.

### 5) 사용자 설치 (= 본인)

```bash
brew tap nu-tree/navis
brew install navis
```

설치 후 caveats 안내대로 `~/.config/navis/env` 에 본인 토큰 작성.

## 새 버전 릴리스 (반복 작업)

```bash
# 1) 메인 레포에서 작업·커밋·push
git tag v0.1.1
git push origin v0.1.1

# 2) sha256 다시 계산
curl -sL https://github.com/nu-tree/namory/archive/refs/tags/v0.1.1.tar.gz | shasum -a 256

# 3) tap 레포 Formula/navis.rb 의 url(버전), sha256 두 줄 갱신 → commit + push

# 4) 사용자 환경
brew update
brew upgrade navis
```

자동화: GitHub Actions 로 (1)~(3) 을 묶을 수 있음(나중에).

## 본인만 사용 ↔ 공개 배포 관계

- tap 레포·소스 레포가 public 이어도 **타인은 토큰이 없어 못 씀** → 자연스러운 제한.
- 정말로 다른 사람이 설치 자체를 못 하게 막으려면 두 레포 모두 private + GitHub
  personal access token 으로 인증해서 받아야 함. 일반적으론 public + 토큰 게이트로 충분.

## 동작 검증 (배포 전 로컬)

```bash
brew install --build-from-source ./homebrew/navis.rb
# Formula 안의 test 블록도 실행:
brew test navis
```
