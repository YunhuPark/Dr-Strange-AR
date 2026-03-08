# 🌀 Dr. Strange AR

웹캠과 손 제스처로 닥터 스트레인지의 마법을 직접 시전하는 **Web AR 프로젝트**입니다.  
MediaPipe 손 추적과 Three.js GPU 파티클 시스템을 결합해 실시간으로 시네마틱한 이펙트를 구현했습니다.

## 🎬 데모 미리보기

> 웹캠이 달린 PC/노트북에서 실행하세요.

**🔗 라이브 데모**: [https://dr-strange-ar.vercel.app](https://dr-strange-ar.vercel.app)

---

## ✨ 기능

| 모드 | 이름 | 손 제스처 | 효과 |
|------|------|-----------|------|
| `[1]` | **Tao Mandalas** | ✊ 양손 주먹 | 양 손바닥에 타오 만달라(마법진) 생성 |
| `[2]` | **Sling Ring** | 🤙 양손 총 모양 (검지 뻗기, 엄지 옆으로, 약지·새끼 접기) → 원 그리기 → 자세 유지 | GPU 파티클 슬링 링 포탈 이펙트 |
| `[3]` | **Time Stone** | 🖐️ 한 손 손바닥 펼치기 | 타임 스톤 이펙트 |

### 슬링 링 사용법
1. 양손을 총 모양으로 만들기 (검지만 뻗고 나머지 접기, 엄지는 옆으로)
2. 오른손 검지로 허공에 원 그리기
3. 원을 완성한 뒤 자세 유지 → 불꽃 포탈이 타오르기 시작!

---

## 🛠️ 기술 스택

- **Frontend**: Vanilla JS (ES Module)
- **3D Rendering**: [Three.js](https://threejs.org/) + Custom GLSL ShaderMaterial
- **Hand Tracking**: [MediaPipe Tasks Vision](https://developers.google.com/mediapipe)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Post Processing**: Three.js `UnrealBloomPass`
- **Particle System**: GPU-accelerated via `THREE.Points` + Simplex Noise Vertex Shader

---

## 🚀 실행 방법

### 요구사항
- Node.js 18+
- 웹캠

### 설치 및 실행

```bash
# 저장소 클론
git clone https://github.com/YunhuPark/Dr-Strange-AR.git
cd Dr-Strange-AR/web

# 패키지 설치
npm install

# 개발 서버 실행
npm run dev
```

브라우저에서 http://localhost:5173 접속 후 웹캠 권한을 허용하面 자동으로 시작됩니다.

---

## 📁 프로젝트 구조

```
Dr-Strange-AR/
├── web/                  # 웹 앱 (Vite 프로젝트)
│   ├── index.html
│   ├── main.js           # 핵심 로직 (Three.js + MediaPipe + Shaders)
│   ├── style.css
│   ├── public/           # 정적 에셋 (마법진 이미지 등)
│   └── package.json
└── README.md
```

---

## 🎨 주요 구현 포인트

### GPU 파티클 시스템 (Sling Ring)
- `THREE.Points` + `ShaderMaterial`로 최대 50,000개의 파티클을 GPU에서 처리
- Vertex Shader 내 Simplex 3D Noise로 안티-그래비티 난기류 구현
- 핫골드 → 오렌지 → 다크레드 컬러 그라데이션
- `THREE.AdditiveBlending`으로 빛이 겹치는 시네마틱 효과

### 실시간 손 추적 & 제스처 인식
- MediaPipe Hand Landmark를 팜 크기 대비 비율로 정규화하여 카메라 거리와 무관한 인식
- 총 모양(Gun Shape) 인식: 검지 뻗음 + 약지/새끼 접힘 + 엄지 위치 체크
- 주먹/열린 손바닥 인식: 손목~손끝 거리 비율 기반

---

## 📄 라이선스

MIT License

---

> This project is a fan-made inspired by the Marvel Studios' *Doctor Strange* franchise. All Marvel characters and related assets are trademarks of Marvel Studios / The Walt Disney Company.
