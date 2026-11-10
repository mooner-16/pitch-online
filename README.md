# ⚽ PITCH ONLINE · 피치 온라인

3D 중계 시점(경기장 옆 관중석에서 내려다보는 시점)으로 즐기는 7대7 축구 게임이에요.

- **AI 대전**: 6개 구단 중 골라서 컴퓨터와 대결 (난이도 3단계, 경기 시간 3/5/8분)
- **온라인 대전**: 방을 만들고 코드나 초대 링크를 보내면 친구와 실시간 1:1
- 키보드, 게임패드, 모바일 터치 모두 지원
- 외부 패키지 없이 Node.js만으로 동작 (`npm install` 해도 설치되는 것이 없어요)

## 폴더 구조

```
pitch-online/
├─ server.js        # 게임 파일 제공 + 웹소켓 대전 서버
├─ package.json
├─ render.yaml      # Render 자동 배포 설정
└─ public/
   ├─ index.html    # 메뉴와 화면 구성
   ├─ style.css
   ├─ game.js       # 3D 화면(Three.js), 조작, 온라인 연결
   └─ sim.js        # 게임 엔진(물리·규칙·AI) - 서버와 브라우저가 같이 씀
```

## 내 컴퓨터에서 실행

Node.js 18 이상이 필요해요.

```bash
npm start
```

브라우저에서 http://localhost:3000 을 열면 돼요. 온라인 대전은 창을 두 개 띄워서 시험해 볼 수 있어요.

## GitHub에 올리기

```bash
git init
git add .
git commit -m "PITCH ONLINE 첫 버전"
git branch -M main
git remote add origin https://github.com/<내아이디>/pitch-online.git
git push -u origin main
```

## Render에 배포하기

**방법 1. Blueprint (render.yaml 사용)**
1. Render 대시보드에서 **New → Blueprint** 를 고릅니다.
2. 방금 올린 GitHub 저장소를 연결하면 `render.yaml`을 읽어서 무료 웹 서비스를 만들어 줘요.

**방법 2. 직접 만들기**
1. **New → Web Service** 에서 저장소를 고릅니다.
2. 아래처럼 설정해요.
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
3. 배포가 끝나면 `https://pitch-online-xxxx.onrender.com` 같은 주소가 생겨요.

> 무료 서버는 한동안 아무도 접속하지 않으면 잠들어요. 다시 접속하면 깨어나는 데 1분 정도 걸릴 수 있어요. 온라인 대전 전에 페이지를 한 번 열어 두면 좋아요.

## 조작법

| 동작 | 키보드 | 게임패드 |
|---|---|---|
| 이동 | W A S D / 방향키 | 왼쪽 스틱 |
| 질주 | Shift | RB / RT |
| 짧은 패스 (수비 시 태클) | J / Z | A |
| 슛 (누르고 있으면 파워) | K / X | B |
| 로빙 스루패스 | L / C | Y |
| 선수 전환 | Q / Space | LB |
| 일시정지 | Esc | Start |

## 바꿔 보기

- **구단·능력치**: `public/sim.js` 맨 위의 `TEAMS`
- **포메이션**: `public/sim.js`의 `KICKOFF`, `SHAPE`
- **AI 난이도**: `public/sim.js`의 `DIFF`

구단과 선수 이름은 모두 가상이에요.
