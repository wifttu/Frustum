# 크레딧 · 라이선스

## 이 게임이 직접 만든 것
- **그림**: 맵 미리보기, 캐릭터·의상 초상화, 아이콘, 스킬·강화·아이템 그림은 모두 이 저장소의 3D 모델(`client/world.js`, `client/character.js`, `tools/assets.js`)을 렌더링한 것이다. 외부 그림·사진·스프라이트를 쓰지 않는다.
- **3D 모델·맵**: 코드로 만든 도형(상자, 원기둥, 구 등)을 조합했다. 외부 모델 파일이 없다.
- **소리·음악**: Web Audio API 로 실시간 합성한다(`client/audio.js`). 외부 음원·효과음 파일이 없다.
- **글꼴·이모지**: 기기에 깔린 기본 글꼴과 기본 이모지로 그린다. 글꼴·이모지 파일을 배포하지 않는다.

## 사용한 오픈소스
| 이름 | 버전 | 쓰는 곳 | 라이선스 | 저작권 |
|---|---|---|---|---|
| three.js | r170 | 브라우저 3D 렌더링 (`vendor/three`) | MIT | Copyright © 2010-2024 three.js authors |
| ws | 8.x | 게임 서버의 WebSocket | MIT | Copyright (c) 2011 Einar Otto Stangvik, (c) 2013 Arnout Kazemier and contributors, (c) 2016 Luigi Pinca and contributors |

배포하는 three.js 파일은 첫 줄에 저작권·라이선스 표시가 그대로 들어 있고, 원문은 `vendor/three/LICENSE` 에 함께 둔다.

### MIT License
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
